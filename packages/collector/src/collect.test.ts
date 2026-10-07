import {describe, expect, it} from 'vitest'
import type {RunShard, Summary, SyncState} from '@gh-workflow-stats/core'
import {collect, type CollectConfig} from './collect'
import type {ApiRun, DataStore, FileWrite, RunsApi} from './github'

const NOW = new Date('2026-10-07T12:00:00Z')

function apiRun(
  id: number,
  createdAt: string,
  extra: Partial<ApiRun> = {}
): ApiRun {
  return {
    id,
    run_attempt: 1,
    workflow_id: 100,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: 'c'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    created_at: createdAt,
    run_started_at: createdAt,
    updated_at: createdAt,
    ...extra
  }
}

function fakeApi(runs: ApiRun[]): RunsApi {
  return {
    async listRuns(created) {
      const [from, to] = created.split('..').map(Date.parse) as [number, number]
      const match = runs.filter(r => {
        const t = Date.parse(r.created_at)
        return t >= from && t <= to
      })
      return {totalCount: match.length, runs: match}
    },
    async listJobs() {
      return []
    }
  }
}

/** An in-memory data branch: a list of commits, each a full file map. */
function memoryStore(initial?: Record<string, unknown>) {
  const commits: {files: Map<string, string>; message: string}[] = []
  if (initial) {
    const files = new Map(
      Object.entries(initial).map(([p, v]) => [p, JSON.stringify(v)])
    )
    commits.push({files, message: 'seed'})
  }
  const store: DataStore = {
    async head() {
      return commits.length === 0 ? null : String(commits.length - 1)
    },
    async read(sha, path) {
      return commits[Number(sha)]?.files.get(path) ?? null
    },
    async commit(parent, writes: FileWrite[], message) {
      expect(parent).toBe(
        commits.length === 0 ? null : String(commits.length - 1)
      )
      const files = new Map(commits.at(-1)?.files ?? [])
      for (const w of writes) files.set(w.path, w.content)
      commits.push({files, message})
      return String(commits.length - 1)
    }
  }
  const file = <T>(path: string): T =>
    JSON.parse(commits.at(-1)?.files.get(path) ?? 'null') as T
  return {store, commits, file}
}

function config(extra: Partial<CollectConfig> = {}): CollectConfig {
  return {
    repository: 'octo-org/octo-repo',
    backfillDays: 30,
    maxRequests: 100,
    recentDays: 30,
    ...extra
  }
}

describe('collect', () => {
  it('creates the data branch with state and summary in an empty repository', async () => {
    const {store, commits, file} = memoryStore()
    const result = await collect(fakeApi([]), store, NOW, config())
    expect(commits).toHaveLength(1)
    expect(file<Summary>('summary.json').months).toEqual([])
    expect(file<SyncState>('state.json').cursor).not.toBeNull()
    expect(result.runsAdded).toBe(0)
  })

  it('writes runs into monthly shards and lists the months in the summary', async () => {
    const {store, file} = memoryStore()
    await collect(
      fakeApi([
        apiRun(1, '2026-09-20T00:00:00Z'),
        apiRun(2, '2026-10-02T00:00:00Z')
      ]),
      store,
      NOW,
      config()
    )
    expect(file<RunShard>('runs/2026-09.json').runs.map(r => r.id)).toEqual([1])
    expect(file<RunShard>('runs/2026-10.json').runs.map(r => r.id)).toEqual([2])
    expect(file<Summary>('summary.json').months).toEqual(['2026-09', '2026-10'])
  })

  it('merges into existing shards, replacing a re-run in place', async () => {
    const first = apiRun(1, '2026-10-07T08:00:00Z')
    const {store, file} = memoryStore()
    await collect(fakeApi([first]), store, NOW, config())
    const rerun = {...first, run_attempt: 2, updated_at: '2026-10-07T11:55:00Z'}
    await collect(
      fakeApi([rerun, apiRun(2, '2026-10-07T11:56:00Z')]),
      store,
      NOW,
      config({backfillDays: 30})
    )
    const runs = file<RunShard>('runs/2026-10.json').runs
    expect(runs.map(r => [r.id, r.attempt])).toEqual([
      [1, 2],
      [2, 1]
    ])
  })

  it('does not commit when nothing new was collected', async () => {
    const {store, commits} = memoryStore()
    await collect(
      fakeApi([apiRun(1, '2026-10-02T00:00:00Z')]),
      store,
      NOW,
      config()
    )
    await collect(
      fakeApi([apiRun(1, '2026-10-02T00:00:00Z')]),
      store,
      NOW,
      config()
    )
    expect(commits).toHaveLength(1)
  })

  it('summarises each workflow over the recent days', async () => {
    const {store, file} = memoryStore()
    await collect(
      fakeApi([
        apiRun(1, '2026-10-01T00:00:00Z'),
        apiRun(2, '2026-10-02T00:00:00Z', {conclusion: 'failure'}),
        apiRun(3, '2026-09-01T00:00:00Z')
      ]),
      store,
      NOW,
      config({backfillDays: 60, recentDays: 14})
    )
    const ci = file<Summary>('summary.json').workflows.find(w => w.id === 100)
    expect(ci?.recent.runs).toBe(2)
    expect(ci?.recent.successRate).toBe(0.5)
  })

  it('records an incomplete sync as data complete only up to its cursor', async () => {
    const {store, file} = memoryStore()
    const result = await collect(
      fakeApi([
        apiRun(1, '2026-10-01T00:00:00Z'),
        apiRun(2, '2026-10-02T00:00:00Z')
      ]),
      store,
      NOW,
      config({maxRequests: 2})
    )
    expect(result.complete).toBe(false)
    expect(file<Summary>('summary.json').syncedThrough).toBe(
      file<SyncState>('state.json').cursor
    )
    expect(
      Date.parse(file<Summary>('summary.json').syncedThrough ?? '')
    ).toBeLessThan(Date.parse('2026-10-01T00:00:00Z'))
  })

  it('refuses data written with another schema version', async () => {
    const {store} = memoryStore({
      'state.json': {schemaVersion: 2, cursor: null}
    })
    await expect(collect(fakeApi([]), store, NOW, config())).rejects.toThrow(
      /schema version 2/
    )
  })

  it('refuses an existing branch that it did not create', async () => {
    const {store, commits} = memoryStore({'summary.json': {schemaVersion: 1}})
    commits[0]?.files.delete('summary.json')
    commits[0]?.files.set('README.md', '# someone else')
    await expect(collect(fakeApi([]), store, NOW, config())).rejects.toThrow(
      /no state\.json/
    )
    expect(commits).toHaveLength(1)
  })

  it('refuses a malformed data file', async () => {
    const {store, commits} = memoryStore({'summary.json': {}})
    commits[0]?.files.set('state.json', '{not json')
    await expect(collect(fakeApi([]), store, NOW, config())).rejects.toThrow(
      /state\.json/
    )
  })
})
