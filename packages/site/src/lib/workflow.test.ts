import {describe, expect, it} from 'vitest'
import type {RunRecord} from '@gh-workflow-stats/core'
import {durationPoints, workflowView} from './workflow'

function run(id: number, extra: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    attempt: 1,
    workflowId: 100,
    workflowName: 'CI',
    workflowPath: '.github/workflows/ci.yml',
    event: 'push',
    branch: 'main',
    headSha: 'd'.repeat(40),
    conclusion: 'success',
    createdAt: '2026-10-05T10:00:00Z',
    startedAt: '2026-10-05T10:00:00Z',
    updatedAt: '2026-10-05T10:02:00Z',
    jobs: [],
    ...extra
  }
}

describe('workflowView', () => {
  const runs = [
    run(1),
    run(2, {branch: 'feature/b'}),
    run(3, {workflowId: 200}),
    run(4, {createdAt: '2026-08-01T00:00:00Z'}),
    run(5, {branch: null})
  ]

  it('keeps only the workflow and range, then the branch', () => {
    const view = workflowView(runs, {
      workflowId: 100,
      from: '2026-10-01T00:00:00Z',
      branch: 'main'
    })
    expect(view.runs.map(r => r.id)).toEqual([1])
  })

  it('offers every branch of the workflow in range, sorted', () => {
    const view = workflowView(runs, {
      workflowId: 100,
      from: '2026-10-01T00:00:00Z'
    })
    expect(view.branches).toEqual(['feature/b', 'main'])
  })

  it('offers the selected branch even when it has no runs in range', () => {
    const view = workflowView(runs, {
      workflowId: 100,
      from: '2026-10-01T00:00:00Z',
      branch: 'gone'
    })
    expect(view.branches).toContain('gone')
  })
})

describe('durationPoints', () => {
  it('groups runs by outcome, leaving out runs with no duration', () => {
    const groups = durationPoints([
      run(1),
      run(2, {conclusion: 'failure'}),
      run(3, {conclusion: 'cancelled'}),
      run(4, {updatedAt: '2026-10-05T09:00:00Z'})
    ])
    expect(groups.map(g => [g.outcome, g.points.map(p => p.id)])).toEqual([
      ['success', [1]],
      ['failure', [2]],
      ['other', [3]]
    ])
  })
})
