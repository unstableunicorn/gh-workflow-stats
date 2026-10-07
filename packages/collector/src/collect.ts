// One collection: read the data branch, sync new runs, write shards, state
// and summary back in a single commit.

import {
  SCHEMA_VERSION,
  emptyTestShard,
  filterRuns,
  flakyTests,
  monthOf,
  paths,
  runStats,
  testPaths,
  type PendingTests,
  type RunRecord,
  type RunShard,
  type SuiteSummary,
  type Summary,
  type SyncState,
  type TestShard,
  type WorkflowSummary
} from '@gh-workflow-stats/core'
import type {ArtifactsApi, DataStore, FileWrite, RunsApi} from './github'
import {sync} from './sync'
import {collectTests} from './tests'

const DAY = 86_400_000

export interface CollectConfig {
  /** `owner/repo`, recorded in the summary. */
  repository: string
  backfillDays: number
  maxRequests: number
  recentDays: number
}

export interface CollectResult {
  runsAdded: number
  complete: boolean
  stoppedBy?: string
  syncedThrough: string
  /** Reports that were skipped, and why. */
  warnings: string[]
  commit: string | null
}

/** Syncs new runs into the data branch; commits only when something changed. */
export async function collect(
  api: RunsApi & ArtifactsApi,
  store: DataStore,
  now: Date,
  config: CollectConfig
): Promise<CollectResult> {
  const head = await store.head()
  const readJson = async <T extends {schemaVersion: number}>(
    path: string
  ): Promise<T | null> =>
    head === null ? null : parseData<T>(path, await store.read(head, path))

  const state = await readJson<SyncState>(paths.state)
  if (head !== null && state === null)
    throw new Error(
      `The data branch exists but has no ${paths.state}, so this collector did not create it. Choose another data-branch.`
    )
  const previous = await readJson<Summary>(paths.summary)

  const syncFrom =
    state?.cursor ??
    new Date(now.getTime() - config.backfillDays * DAY).toISOString()
  const recentFrom = new Date(
    now.getTime() - config.recentDays * DAY
  ).toISOString()
  const firstMonth = monthOf(
    Date.parse(syncFrom) < Date.parse(recentFrom) ? syncFrom : recentFrom
  )
  const shards = new Map<string, RunShard>()
  const loadRunShard = async (month: string): Promise<void> => {
    if (shards.has(month) || !(previous?.months ?? []).includes(month)) return
    const shard = await readJson<RunShard>(paths.shard(month))
    if (shard === null)
      throw new Error(
        `${paths.shard(month)} is listed in the summary but missing`
      )
    shards.set(month, shard)
  }
  for (const month of previous?.months ?? [])
    if (month >= firstMonth) await loadRunShard(month)
  for (const p of state?.pendingTests ?? []) await loadRunShard(p.month)

  const stored = [...shards.values()].flatMap(s => s.runs)
  const result = await sync({
    api,
    now,
    cursor: state?.cursor ?? null,
    known: new Map(
      stored.map(r => [r.id, {attempt: r.attempt, updatedAt: r.updatedAt}])
    ),
    backfillDays: config.backfillDays,
    maxRequests: config.maxRequests
  })

  const touched = mergeRuns(shards, result.runs)

  const testShards = new Map<string, TestShard>()
  const loadTestShard = async (month: string): Promise<TestShard> =>
    testShards.get(month) ??
    (await readJson<TestShard>(testPaths.shard(month))) ??
    emptyTestShard(month)
  const previousPending = state?.pendingTests ?? []
  const queue = dedupe([
    ...previousPending,
    ...result.runs.map(r => ({
      runId: r.id,
      attempt: r.attempt,
      month: monthOf(r.createdAt)
    }))
  ])
  const tests = await collectTests({
    api,
    queue,
    findRun: p =>
      shards
        .get(p.month)
        ?.runs.find(r => r.id === p.runId && r.attempt === p.attempt),
    loadShard: loadTestShard,
    budget: config.maxRequests - result.requests
  })
  for (const [month, shard] of tests.shards) testShards.set(month, shard)

  const stoppedBy = result.stoppedBy ?? tests.stoppedBy
  const outcome = {
    runsAdded: result.runs.length,
    complete: result.complete && tests.pending.length === 0,
    ...(stoppedBy === undefined ? {} : {stoppedBy}),
    syncedThrough: result.cursor,
    warnings: tests.warnings
  }
  const pendingChanged =
    JSON.stringify(tests.pending) !== JSON.stringify(previousPending)
  if (
    result.runs.length === 0 &&
    tests.shards.size === 0 &&
    !pendingChanged &&
    head !== null
  )
    return {...outcome, commit: null}
  const months = [
    ...new Set([...(previous?.months ?? []), ...shards.keys()])
  ].sort()
  const recent = filterRuns(
    [...shards.values()].flatMap(s => s.runs),
    {from: recentFrom}
  )
  const summary: Summary = {
    schemaVersion: SCHEMA_VERSION,
    repository: config.repository,
    generatedAt: now.toISOString(),
    syncedThrough: result.cursor,
    recentDays: config.recentDays,
    months,
    workflows: summariseWorkflows(previous?.workflows ?? [], recent)
  }
  const testMonths = [
    ...new Set([...(previous?.tests?.months ?? []), ...testShards.keys()])
  ].sort()
  if (testMonths.length > 0) {
    for (const month of testMonths)
      if (month >= monthOf(recentFrom))
        testShards.set(month, await loadTestShard(month))
    summary.tests = {
      months: testMonths,
      suites: summariseSuites(
        previous?.tests?.suites ?? [],
        [...testShards.values()],
        recentFrom
      )
    }
  }
  const newState: SyncState = {
    schemaVersion: SCHEMA_VERSION,
    cursor: result.cursor,
    pendingTests: tests.pending
  }

  const files: FileWrite[] = [
    ...touched.map(m => ({
      path: paths.shard(m),
      content: toJson(shards.get(m))
    })),
    ...[...tests.shards.keys()].sort().map(m => ({
      path: testPaths.shard(m),
      content: toJson(testShards.get(m))
    })),
    {path: paths.state, content: toJson(newState)},
    {path: paths.summary, content: toJson(summary)}
  ]
  const commit = await store.commit(
    head,
    files,
    `Collect ${result.runs.length} workflow runs`
  )
  return {...outcome, commit}
}

/** Upserts runs into their month's shard by id; returns the months touched. */
function mergeRuns(shards: Map<string, RunShard>, runs: RunRecord[]): string[] {
  const touched = new Set<string>()
  for (const run of runs) {
    const month = monthOf(run.createdAt)
    const shard = shards.get(month) ?? {
      schemaVersion: SCHEMA_VERSION,
      month,
      runs: []
    }
    shard.runs = [...shard.runs.filter(r => r.id !== run.id), run].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt)
    )
    shards.set(month, shard)
    touched.add(month)
  }
  return [...touched].sort()
}

function dedupe(items: PendingTests[]): PendingTests[] {
  const seen = new Set<string>()
  return items.filter(p => {
    const id = `${p.runId}:${p.attempt}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Every suite seen before or recently, with numbers over the recent runs. */
function summariseSuites(
  previous: SuiteSummary[],
  shards: TestShard[],
  recentFrom: string
): SuiteSummary[] {
  const runs = shards
    .flatMap(s => s.runs)
    .filter(r => Date.parse(r.createdAt) >= Date.parse(recentFrom))
  const fromDate = recentFrom.slice(0, 10)
  const suites = new Set([
    ...previous.map(s => s.suite),
    ...runs.map(r => r.suite)
  ])
  return [...suites].sort().map(suite => {
    const own = runs.filter(r => r.suite === suite)
    const keys = new Set<string>()
    for (const shard of shards)
      for (const [date, day] of Object.entries(shard.daily))
        if (date >= fromDate)
          for (const index of Object.keys(day)) {
            const key = shard.tests[Number(index)]
            if (key?.startsWith(`${suite}::`)) keys.add(key)
          }
    return {
      suite,
      recent: {
        reports: own.length,
        tests: keys.size,
        failures: own.reduce((n, r) => n + r.failed.length, 0),
        flaky: flakyTests(own).length
      }
    }
  })
}

/** Every workflow seen before or recently, with stats over the recent runs. */
function summariseWorkflows(
  previous: WorkflowSummary[],
  recent: RunRecord[]
): WorkflowSummary[] {
  const named = new Map(previous.map(w => [w.id, {name: w.name, path: w.path}]))
  for (const r of recent)
    named.set(r.workflowId, {name: r.workflowName, path: r.workflowPath})
  return [...named.entries()]
    .map(([id, w]) => ({
      id,
      ...w,
      recent: runStats(recent.filter(r => r.workflowId === id))
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function parseData<T extends {schemaVersion: number}>(
  path: string,
  text: string | null
): T | null {
  if (text === null) return null
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `${path} on the data branch is not valid JSON: ${String(error)}`,
      {cause: error}
    )
  }
  const version = (data as {schemaVersion?: unknown} | null)?.schemaVersion
  if (version !== SCHEMA_VERSION)
    throw new Error(
      `${path} has schema version ${String(version)}; this collector reads version ${SCHEMA_VERSION}`
    )
  return data as T
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 1)}\n`
}
