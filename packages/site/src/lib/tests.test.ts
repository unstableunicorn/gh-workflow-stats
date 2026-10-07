import {describe, expect, it} from 'vitest'
import type {TestRunRecord, TestShard} from '@gh-workflow-stats/core'
import {displayName, testDetail, testsView} from './tests'

function testRun(overrides: Partial<TestRunRecord>): TestRunRecord {
  return {
    runId: 1,
    attempt: 1,
    suite: 'unit',
    headSha: 'a'.repeat(40),
    branch: 'main',
    workflowId: 100,
    createdAt: '2026-10-05T10:00:00Z',
    total: 2,
    passed: 2,
    failed: [],
    skipped: [],
    ...overrides
  }
}

const shard: TestShard = {
  schemaVersion: 1,
  month: '2026-10',
  tests: ['unit::pkg::a', 'unit::pkg::b', 'e2e::login'],
  runs: [
    testRun({runId: 1, failed: ['unit::pkg::a']}),
    testRun({runId: 2}),
    testRun({runId: 3, suite: 'e2e', createdAt: '2026-10-06T00:00:00Z'}),
    testRun({
      runId: 4,
      createdAt: '2026-09-01T00:00:00Z',
      failed: ['unit::pkg::b']
    })
  ],
  daily: {
    '2026-10-05': {'0': [2, 1, 30, 20], '1': [2, 0, 400, 300]},
    '2026-10-06': {'2': [1, 0, 5000, 5000]},
    '2026-09-01': {'1': [1, 1, 10, 10]}
  }
}

describe('testsView', () => {
  it('keeps runs in range and in the suite', () => {
    const view = testsView([shard], {
      from: '2026-10-01T00:00:00Z',
      suite: 'unit'
    })
    expect(view.runs.map(r => r.runId)).toEqual([1, 2])
  })

  it('lists every suite in range for the filter, sorted', () => {
    expect(testsView([shard], {from: '2026-10-01T00:00:00Z'}).suites).toEqual([
      'e2e',
      'unit'
    ])
  })

  it('finds flaky and failing tests in range', () => {
    const view = testsView([shard], {from: '2026-10-01T00:00:00Z'})
    expect(view.flaky.map(f => f.key)).toEqual(['unit::pkg::a'])
    expect(view.failing.map(f => f.key)).toEqual(['unit::pkg::a'])
  })

  it('ranks the slowest tests in the suite', () => {
    const view = testsView([shard], {
      from: '2026-10-01T00:00:00Z',
      suite: 'unit'
    })
    expect(view.slowest.map(t => t.key)).toEqual([
      'unit::pkg::b',
      'unit::pkg::a'
    ])
  })

  it('totals executions and failures per day in the suite', () => {
    const view = testsView([shard], {
      from: '2026-10-01T00:00:00Z',
      suite: 'unit'
    })
    expect(view.daily).toEqual([
      {date: '2026-10-05', executions: 4, failures: 1}
    ])
  })
})

describe('testDetail', () => {
  it('gives the daily history and the failing runs, newest first', () => {
    const detail = testDetail([shard], 'unit::pkg::b', '2026-08-01T00:00:00Z')
    expect(detail.history.map(d => d.date)).toEqual([
      '2026-09-01',
      '2026-10-05'
    ])
    expect(detail.failures.map(r => r.runId)).toEqual([4])
  })

  it('leaves out days and failures before the start', () => {
    const detail = testDetail([shard], 'unit::pkg::b', '2026-10-01T00:00:00Z')
    expect(detail.history.map(d => d.date)).toEqual(['2026-10-05'])
    expect(detail.failures).toEqual([])
  })
})

describe('displayName', () => {
  it('splits the suite from the rest of the key', () => {
    expect(displayName('unit::pkg::adds')).toEqual({
      suite: 'unit',
      name: 'pkg::adds'
    })
  })
})
