import {describe, expect, it} from 'vitest'
import type {JobRecord, RunRecord} from './schema'
import {
  dailySeries,
  filterRuns,
  jobQueueMs,
  monthOf,
  percentile,
  runDurationMs,
  runStats,
  slowestJobs
} from './stats'

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 1,
    name: 'build',
    conclusion: 'success',
    createdAt: '2026-10-01T10:00:00Z',
    startedAt: '2026-10-01T10:00:10Z',
    completedAt: '2026-10-01T10:02:00Z',
    ...overrides
  }
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 1,
    attempt: 1,
    workflowId: 100,
    workflowName: 'CI',
    workflowPath: '.github/workflows/ci.yml',
    event: 'push',
    branch: 'main',
    headSha: 'a'.repeat(40),
    conclusion: 'success',
    createdAt: '2026-10-01T10:00:00Z',
    startedAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:05:00Z',
    jobs: [job()],
    ...overrides
  }
}

describe('percentile', () => {
  it('returns null for no values', () => {
    expect(percentile([], 50)).toBeNull()
  })

  it('uses the nearest rank', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([1, 2, 3, 4], 25)).toBe(1)
  })
})

describe('runDurationMs', () => {
  it('is the time from start to last update', () => {
    expect(runDurationMs(run())).toBe(5 * 60_000)
  })

  it('is null when the times are out of order', () => {
    expect(
      runDurationMs(run({updatedAt: '2026-10-01T09:00:00Z'}))
    ).toBeNull()
  })
})

describe('jobQueueMs', () => {
  it('is the time from creation to start', () => {
    expect(jobQueueMs(job())).toBe(10_000)
  })

  it('is null for a job that never started', () => {
    expect(jobQueueMs(job({startedAt: null}))).toBeNull()
  })
})

describe('runStats', () => {
  it('reports nulls for no runs', () => {
    expect(runStats([])).toMatchObject({
      runs: 0,
      successRate: null,
      durationP50Ms: null
    })
  })

  it('leaves cancelled and skipped runs out of the success rate', () => {
    const stats = runStats([
      run({conclusion: 'success'}),
      run({conclusion: 'failure'}),
      run({conclusion: 'timed_out'}),
      run({conclusion: 'cancelled'}),
      run({conclusion: 'skipped'})
    ])
    expect(stats.runs).toBe(5)
    expect(stats.success).toBe(1)
    expect(stats.failure).toBe(2)
    expect(stats.successRate).toBeCloseTo(1 / 3)
  })

  it('takes queue time from the jobs', () => {
    const stats = runStats([
      run({jobs: [job({startedAt: '2026-10-01T10:00:30Z'})]})
    ])
    expect(stats.queueP50Ms).toBe(30_000)
  })
})

describe('monthOf', () => {
  it('uses the UTC month', () => {
    expect(monthOf('2026-10-31T23:30:00Z')).toBe('2026-10')
    expect(monthOf('2026-11-01T00:30:00+02:00')).toBe('2026-10')
  })
})

describe('filterRuns', () => {
  const runs = [
    run({id: 1, workflowId: 100, branch: 'main'}),
    run({id: 2, workflowId: 200, branch: 'main'}),
    run({id: 3, workflowId: 100, branch: 'feature/x'}),
    run({id: 4, workflowId: 100, createdAt: '2026-09-01T00:00:00Z'})
  ]

  it('filters by workflow and branch', () => {
    const ids = filterRuns(runs, {workflowId: 100, branch: 'main'}).map(
      r => r.id
    )
    expect(ids).toEqual([1, 4])
  })

  it('keeps runs created in [from, to)', () => {
    const ids = filterRuns(runs, {
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-02T00:00:00Z'
    }).map(r => r.id)
    expect(ids).toEqual([1, 2, 3])
  })
})

describe('dailySeries', () => {
  it('groups by UTC day in date order, with empty days left out', () => {
    const series = dailySeries([
      run({createdAt: '2026-10-03T08:00:00Z', conclusion: 'failure'}),
      run({createdAt: '2026-10-01T08:00:00Z'}),
      run({createdAt: '2026-10-01T20:00:00Z'})
    ])
    expect(series.map(d => [d.date, d.stats.runs])).toEqual([
      ['2026-10-01', 2],
      ['2026-10-03', 1]
    ])
    expect(series[1]?.stats.successRate).toBe(0)
  })
})

describe('slowestJobs', () => {
  it('ranks job names by p95 duration, slowest first', () => {
    const jobs = (name: string, minutes: number): JobRecord =>
      job({
        name,
        startedAt: '2026-10-01T10:00:00Z',
        completedAt: `2026-10-01T10:${String(minutes).padStart(2, '0')}:00Z`
      })
    const ranked = slowestJobs(
      [
        run({jobs: [jobs('lint', 1), jobs('test', 9)]}),
        run({jobs: [jobs('lint', 2), jobs('test', 7)]})
      ],
      5
    )
    expect(ranked.map(j => [j.name, j.count, j.p95Ms])).toEqual([
      ['test', 2, 9 * 60_000],
      ['lint', 2, 2 * 60_000]
    ])
  })

  it('returns at most the limit', () => {
    const ranked = slowestJobs(
      [run({jobs: [job({name: 'a'}), job({name: 'b'})]})],
      1
    )
    expect(ranked).toHaveLength(1)
  })
})
