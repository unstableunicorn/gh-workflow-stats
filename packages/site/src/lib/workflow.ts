// What the workflow view shows: its runs under the URL's filters, the branch
// choices, and the duration points grouped by outcome.

import {
  FAILED_CONCLUSIONS,
  dailySeries,
  filterRuns,
  runDurationMs,
  slowestJobs,
  type DayStats,
  type JobTiming,
  type RunRecord
} from '@gh-workflow-stats/core'

export interface WorkflowFilter {
  workflowId: number
  from?: string
  branch?: string
}

export interface WorkflowView {
  runs: RunRecord[]
  branches: string[]
  daily: DayStats[]
  slowest: JobTiming[]
}

/** The workflow's runs in range and on the branch, with derived series. */
export function workflowView(
  all: RunRecord[],
  filter: WorkflowFilter
): WorkflowView {
  const inRange = filterRuns(all, {
    workflowId: filter.workflowId,
    ...(filter.from === undefined ? {} : {from: filter.from})
  })
  const runs =
    filter.branch === undefined
      ? inRange
      : filterRuns(inRange, {branch: filter.branch})
  const branches = new Set(
    inRange.map(r => r.branch).filter((b): b is string => b !== null)
  )
  if (filter.branch !== undefined) branches.add(filter.branch)
  return {
    runs,
    branches: [...branches].sort(),
    daily: dailySeries(runs),
    slowest: slowestJobs(runs, 10)
  }
}

export type Outcome = 'success' | 'failure' | 'other'

export interface DurationPoint {
  id: number
  createdAt: string
  durationMs: number
  branch: string | null
  conclusion: string | null
}

function outcomeOf(conclusion: string | null): Outcome {
  if (conclusion === 'success') return 'success'
  return FAILED_CONCLUSIONS.has(conclusion ?? '') ? 'failure' : 'other'
}

/** Run durations grouped by outcome, in a fixed order; empty groups left out. */
export function durationPoints(
  runs: RunRecord[]
): {outcome: Outcome; points: DurationPoint[]}[] {
  const groups = new Map<Outcome, DurationPoint[]>([
    ['success', []],
    ['failure', []],
    ['other', []]
  ])
  for (const r of runs) {
    const durationMs = runDurationMs(r)
    if (durationMs === null) continue
    groups.get(outcomeOf(r.conclusion))?.push({
      id: r.id,
      createdAt: r.createdAt,
      durationMs,
      branch: r.branch,
      conclusion: r.conclusion
    })
  }
  return [...groups.entries()]
    .filter(([, points]) => points.length > 0)
    .map(([outcome, points]) => ({outcome, points}))
}
