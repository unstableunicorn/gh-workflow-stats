// Incremental sync: fetch completed runs created since the cursor, oldest
// window first, within a request budget, and say where to resume.

import type {RunRecord} from '@gh-workflow-stats/core'
import {toRunRecord, type ApiRun, type RunsApi} from './github'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const MAX_WINDOW = 7 * DAY
const MIN_WINDOW = MINUTE
const PAGE_SIZE = 100
/** GitHub returns at most this many runs for one filtered query. */
const QUERY_CAP = 1000
/** Re-list this far back each time, to pick up re-runs and late listings. */
const REVISIT = DAY
/** A run still in progress after this long no longer holds the cursor. */
const STALE_AFTER = 2 * DAY

/** Thrown by a RunsApi when GitHub rate-limits the token. */
export class RateLimitError extends Error {}

export interface SyncOptions {
  api: RunsApi
  now: Date
  /** Where the last sync said to resume; null for a first sync. */
  cursor: string | null
  /** Stored runs by id, to skip refetching ones that have not changed. */
  known: Map<number, {attempt: number; updatedAt: string}>
  backfillDays: number
  /** A soft cap on API requests for this sync. */
  maxRequests: number
}

export interface SyncResult {
  runs: RunRecord[]
  cursor: string
  /** False when the budget or a rate limit stopped the sync early. */
  complete: boolean
  stoppedBy?: string
  /** API requests this sync made. */
  requests: number
}

class Stop extends Error {}

/** Fetches new and changed completed runs; see SyncResult. */
export async function sync(opts: SyncOptions): Promise<SyncResult> {
  const now = opts.now.getTime()
  const collected = new Map<number, RunRecord>()
  let requests = 0
  let hold: string | null = null
  let from =
    opts.cursor === null
      ? now - opts.backfillDays * DAY
      : Date.parse(opts.cursor)
  let window = MAX_WINDOW

  const spend = (): void => {
    if (requests >= opts.maxRequests)
      throw new Stop(`request budget of ${opts.maxRequests}`)
    requests++
  }

  const earliest = (a: string | null, b: string): string =>
    a !== null && Date.parse(a) <= Date.parse(b) ? a : b

  try {
    while (from < now) {
      const to = Math.min(from + window, now)
      const listed = await listWindow(opts.api, from, to, spend)
      if (listed === 'too-many') {
        if (window <= MIN_WINDOW)
          throw new Error('More than 1,000 runs in one minute')
        window = Math.max(MIN_WINDOW, Math.floor(window / 2))
        continue
      }
      for (const run of listed) {
        if (run.status !== 'completed') {
          if (now - Date.parse(run.created_at) < STALE_AFTER)
            hold = earliest(hold, run.created_at)
          continue
        }
        const attempt = run.run_attempt ?? 1
        const seen = collected.get(run.id) ?? opts.known.get(run.id)
        if (seen?.attempt === attempt && seen.updatedAt === run.updated_at)
          continue
        spend()
        collected.set(
          run.id,
          toRunRecord(run, await opts.api.listJobs(run.id, attempt))
        )
      }
      from = to
      window = Math.min(MAX_WINDOW, window * 2)
    }
  } catch (error) {
    if (!(error instanceof Stop || error instanceof RateLimitError)) throw error
    const stoppedBy =
      error instanceof RateLimitError
        ? `rate limit: ${error.message}`
        : error.message
    return {
      runs: [...collected.values()],
      cursor: earliest(hold, new Date(from).toISOString()),
      complete: false,
      requests,
      stoppedBy
    }
  }

  return {
    runs: [...collected.values()],
    cursor: earliest(hold, new Date(now - REVISIT).toISOString()),
    complete: true,
    requests
  }
}

/** Every run created in [from, to], oldest first, or 'too-many' past the cap. */
async function listWindow(
  api: RunsApi,
  from: number,
  to: number,
  spend: () => void
): Promise<ApiRun[] | 'too-many'> {
  const created = `${new Date(from).toISOString()}..${new Date(to).toISOString()}`
  const runs: ApiRun[] = []
  for (let page = 1; ; page++) {
    spend()
    const result = await api.listRuns(created, page)
    if (result.totalCount > QUERY_CAP) return 'too-many'
    runs.push(...result.runs)
    if (result.runs.length < PAGE_SIZE || runs.length >= result.totalCount)
      break
  }
  return runs.sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
  )
}
