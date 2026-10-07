// Statistics over stored runs: percentiles, durations, daily series, slow jobs.
// Pure functions shared by the collector's summary and the site's views.

import type {JobRecord, RunRecord, RunStats} from './schema'

/** Conclusions that count as a failed run. */
export const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set([
  'failure',
  'timed_out',
  'startup_failure'
])

/** The nearest-rank percentile `p` (0–100) of `values`, or null if empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1] ?? null
}

function spanMs(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null
  const ms = Date.parse(to) - Date.parse(from)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** A run's wall-clock time from start to its last update, or null. */
export function runDurationMs(run: RunRecord): number | null {
  return spanMs(run.startedAt, run.updatedAt)
}

/** How long a job waited for a runner, or null if it never started. */
export function jobQueueMs(job: JobRecord): number | null {
  return spanMs(job.createdAt, job.startedAt)
}

/** How long a job ran, or null if it did not start and finish. */
export function jobDurationMs(job: JobRecord): number | null {
  return spanMs(job.startedAt, job.completedAt)
}

function present(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null)
}

/** Headline numbers; cancelled and skipped runs count neither way. */
export function runStats(runs: RunRecord[]): RunStats {
  const success = runs.filter(r => r.conclusion === 'success').length
  const failure = runs.filter(r =>
    FAILED_CONCLUSIONS.has(r.conclusion ?? '')
  ).length
  const durations = present(runs.map(runDurationMs))
  const queues = present(runs.flatMap(r => r.jobs.map(jobQueueMs)))
  return {
    runs: runs.length,
    success,
    failure,
    successRate: success + failure > 0 ? success / (success + failure) : null,
    durationP50Ms: percentile(durations, 50),
    durationP95Ms: percentile(durations, 95),
    queueP50Ms: percentile(queues, 50)
  }
}

/** The UTC month `YYYY-MM` of an ISO timestamp. */
export function monthOf(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 7)
}

function dayOf(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 10)
}

export interface RunFilter {
  workflowId?: number
  branch?: string
  /** Inclusive lower bound on createdAt (ISO). */
  from?: string
  /** Exclusive upper bound on createdAt (ISO). */
  to?: string
}

/** The runs matching every set field of `filter`. */
export function filterRuns(runs: RunRecord[], filter: RunFilter): RunRecord[] {
  const from = filter.from === undefined ? null : Date.parse(filter.from)
  const to = filter.to === undefined ? null : Date.parse(filter.to)
  return runs.filter(r => {
    const created = Date.parse(r.createdAt)
    if (filter.workflowId !== undefined && r.workflowId !== filter.workflowId)
      return false
    if (filter.branch !== undefined && r.branch !== filter.branch) return false
    if (from !== null && created < from) return false
    if (to !== null && created >= to) return false
    return true
  })
}

export interface DayStats {
  date: string
  stats: RunStats
}

/** Stats per UTC day, oldest first; days with no runs are left out. */
export function dailySeries(runs: RunRecord[]): DayStats[] {
  const byDay = new Map<string, RunRecord[]>()
  for (const r of runs) {
    const day = dayOf(r.createdAt)
    byDay.set(day, [...(byDay.get(day) ?? []), r])
  }
  return [...byDay.keys()]
    .sort()
    .map(date => ({date, stats: runStats(byDay.get(date) ?? [])}))
}

export interface JobTiming {
  name: string
  count: number
  p50Ms: number | null
  p95Ms: number | null
}

/** Job names ranked by p95 duration, slowest first, at most `limit`. */
export function slowestJobs(runs: RunRecord[], limit: number): JobTiming[] {
  const byName = new Map<string, number[]>()
  for (const j of runs.flatMap(r => r.jobs)) {
    const ms = jobDurationMs(j)
    if (ms !== null) byName.set(j.name, [...(byName.get(j.name) ?? []), ms])
  }
  return [...byName.entries()]
    .map(([name, ms]) => ({
      name,
      count: ms.length,
      p50Ms: percentile(ms, 50),
      p95Ms: percentile(ms, 95)
    }))
    .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))
    .slice(0, limit)
}
