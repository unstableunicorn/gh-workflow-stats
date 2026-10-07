// One collection: read the data branch, sync new runs, write shards, state
// and summary back in a single commit.

import {
  SCHEMA_VERSION,
  filterRuns,
  monthOf,
  paths,
  runStats,
  type RunRecord,
  type RunShard,
  type Summary,
  type SyncState,
  type WorkflowSummary
} from '@gh-workflow-stats/core'
import type {DataStore, FileWrite, RunsApi} from './github'
import {sync} from './sync'

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
  commit: string | null
}

/** Syncs new runs into the data branch; commits only when something changed. */
export async function collect(
  api: RunsApi,
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
  for (const month of previous?.months ?? []) {
    if (month < firstMonth) continue
    const shard = await readJson<RunShard>(paths.shard(month))
    if (shard === null)
      throw new Error(
        `${paths.shard(month)} is listed in the summary but missing`
      )
    shards.set(month, shard)
  }

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

  const outcome = {
    runsAdded: result.runs.length,
    complete: result.complete,
    ...(result.stoppedBy === undefined ? {} : {stoppedBy: result.stoppedBy}),
    syncedThrough: result.cursor
  }
  if (result.runs.length === 0 && head !== null)
    return {...outcome, commit: null}

  const touched = mergeRuns(shards, result.runs)
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
  const newState: SyncState = {
    schemaVersion: SCHEMA_VERSION,
    cursor: result.cursor
  }

  const files: FileWrite[] = [
    ...touched.map(m => ({
      path: paths.shard(m),
      content: toJson(shards.get(m))
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
