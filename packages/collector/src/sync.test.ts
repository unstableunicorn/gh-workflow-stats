import {describe, expect, it} from 'vitest'
import type {ApiJob, ApiRun, RunsApi} from './github'
import {RateLimitError, sync, type SyncOptions} from './sync'

const NOW = new Date('2026-10-07T12:00:00Z')
const DAY = 86_400_000

function apiRun(id: number, createdAt: string, extra: Partial<ApiRun> = {}): ApiRun {
  return {
    id,
    run_attempt: 1,
    workflow_id: 100,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: 'b'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    created_at: createdAt,
    run_started_at: createdAt,
    updated_at: createdAt,
    ...extra
  }
}

const aJob: ApiJob = {
  id: 1,
  name: 'build',
  conclusion: 'success',
  created_at: '2026-10-01T00:00:00Z',
  started_at: '2026-10-01T00:00:05Z',
  completed_at: '2026-10-01T00:01:00Z'
}

/** A fake API serving `runs`, honouring the created range and GitHub's 1,000 cap. */
function fakeApi(runs: ApiRun[], opts: {failJobsAfter?: number} = {}) {
  const calls = {list: [] as string[], jobs: [] as number[]}
  const api: RunsApi = {
    async listRuns(created, page) {
      calls.list.push(created)
      const [from, to] = created.split('..').map(Date.parse) as [number, number]
      const match = runs
        .filter(r => {
          const t = Date.parse(r.created_at)
          return t >= from && t <= to
        })
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      const capped = match.slice(0, 1000)
      return {totalCount: match.length, runs: capped.slice((page - 1) * 100, page * 100)}
    },
    async listJobs(runId) {
      if (opts.failJobsAfter !== undefined && calls.jobs.length >= opts.failJobsAfter)
        throw new RateLimitError('rate limited')
      calls.jobs.push(runId)
      return [aJob]
    }
  }
  return {api, calls}
}

function options(api: RunsApi, extra: Partial<SyncOptions> = {}): SyncOptions {
  return {
    api,
    now: NOW,
    cursor: null,
    known: new Map(),
    backfillDays: 10,
    maxRequests: 1000,
    ...extra
  }
}

describe('sync', () => {
  it('backfills from backfillDays ago when there is no cursor', async () => {
    const {api, calls} = fakeApi([
      apiRun(1, '2026-09-20T00:00:00Z'),
      apiRun(2, '2026-09-28T00:00:00Z'),
      apiRun(3, '2026-10-06T00:00:00Z')
    ])
    const result = await sync(options(api))
    expect(result.runs.map(r => r.id)).toEqual([2, 3])
    expect(calls.list[0]).toMatch(/^2026-09-27T12:00:00\.000Z\.\./)
    expect(result.complete).toBe(true)
  })

  it('starts from the cursor and stores runs with their jobs', async () => {
    const {api} = fakeApi([apiRun(1, '2026-10-01T00:00:00Z'), apiRun(2, '2026-10-05T00:00:00Z')])
    const result = await sync(options(api, {cursor: '2026-10-04T00:00:00Z'}))
    expect(result.runs.map(r => r.id)).toEqual([2])
    expect(result.runs[0]?.jobs.map(j => j.name)).toEqual(['build'])
  })

  it('moves the cursor to a day before now, to revisit re-runs', async () => {
    const {api} = fakeApi([apiRun(1, '2026-10-05T00:00:00Z')])
    const result = await sync(options(api, {cursor: '2026-10-04T00:00:00Z'}))
    expect(result.cursor).toBe(new Date(NOW.getTime() - DAY).toISOString())
  })

  it('holds the cursor at the oldest run still in progress, and skips it', async () => {
    const {api} = fakeApi([
      apiRun(1, '2026-10-06T09:00:00Z', {status: 'in_progress', conclusion: null}),
      apiRun(2, '2026-10-07T10:00:00Z')
    ])
    const result = await sync(options(api, {cursor: '2026-10-06T00:00:00Z'}))
    expect(result.runs.map(r => r.id)).toEqual([2])
    expect(result.cursor).toBe('2026-10-06T09:00:00Z')
  })

  it('does not hold the cursor for a run stuck in progress for days', async () => {
    const {api} = fakeApi([
      apiRun(1, '2026-10-01T09:00:00Z', {status: 'queued', conclusion: null})
    ])
    const result = await sync(options(api, {cursor: '2026-09-30T00:00:00Z'}))
    expect(result.cursor).toBe(new Date(NOW.getTime() - DAY).toISOString())
  })

  it('does not refetch jobs for a run it already stored unchanged', async () => {
    const run = apiRun(1, '2026-10-05T00:00:00Z')
    const {api, calls} = fakeApi([run])
    const known = new Map([[1, {attempt: 1, updatedAt: run.updated_at}]])
    const result = await sync(options(api, {cursor: '2026-10-04T00:00:00Z', known}))
    expect(calls.jobs).toEqual([])
    expect(result.runs).toEqual([])
  })

  it('refetches a run that was re-run since it was stored', async () => {
    const run = apiRun(1, '2026-10-05T00:00:00Z', {run_attempt: 2})
    const {api} = fakeApi([run])
    const known = new Map([[1, {attempt: 1, updatedAt: run.updated_at}]])
    const result = await sync(options(api, {cursor: '2026-10-04T00:00:00Z', known}))
    expect(result.runs.map(r => r.attempt)).toEqual([2])
  })

  it('narrows the window when a range holds more than 1,000 runs', async () => {
    const many = Array.from({length: 1500}, (_, i) =>
      apiRun(i + 1, new Date(Date.parse('2026-10-05T00:00:00Z') + i * 60_000).toISOString())
    )
    const {api} = fakeApi(many)
    const result = await sync(
      options(api, {cursor: '2026-10-04T00:00:00Z', maxRequests: 5000})
    )
    expect(result.runs).toHaveLength(1500)
    expect(result.complete).toBe(true)
  })

  it('stops at the request budget and resumes from where it stopped', async () => {
    const runs = [
      apiRun(1, '2026-10-01T00:00:00Z'),
      apiRun(2, '2026-10-02T00:00:00Z'),
      apiRun(3, '2026-10-06T00:00:00Z')
    ]
    const first = await sync(
      options(fakeApi(runs).api, {cursor: '2026-09-30T00:00:00Z', maxRequests: 3})
    )
    expect(first.complete).toBe(false)
    expect(first.runs.map(r => r.id)).toEqual([1, 2])
    expect(first.cursor).toBe('2026-09-30T00:00:00.000Z')

    const known = new Map(first.runs.map(r => [r.id, {attempt: r.attempt, updatedAt: r.updatedAt}]))
    const second = await sync(options(fakeApi(runs).api, {cursor: first.cursor, known}))
    expect(second.runs.map(r => r.id)).toEqual([3])
    expect(second.complete).toBe(true)
  })

  it('stops on a rate limit, keeping what it fetched', async () => {
    const {api} = fakeApi(
      [apiRun(1, '2026-10-05T00:00:00Z'), apiRun(2, '2026-10-05T01:00:00Z')],
      {failJobsAfter: 1}
    )
    const result = await sync(options(api, {cursor: '2026-10-04T00:00:00Z'}))
    expect(result.complete).toBe(false)
    expect(result.runs.map(r => r.id)).toEqual([1])
    expect(result.stoppedBy).toMatch(/rate limit/)
  })

  it('lets any other API error fail the sync', async () => {
    const {api} = fakeApi([apiRun(1, '2026-10-05T00:00:00Z')])
    api.listJobs = async () => {
      throw new Error('Resource not accessible by integration')
    }
    await expect(sync(options(api, {cursor: '2026-10-04T00:00:00Z'}))).rejects.toThrow(
      /not accessible/
    )
  })

  it('handles an empty repository', async () => {
    const result = await sync(options(fakeApi([]).api))
    expect(result.runs).toEqual([])
    expect(result.complete).toBe(true)
  })
})
