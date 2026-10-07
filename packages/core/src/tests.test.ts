import {describe, expect, it} from 'vitest'
import type {RunRecord} from './schema'
import {
  addReport,
  emptyTestShard,
  failingTests,
  flakyTests,
  testHistory,
  testKey,
  testTimings,
  validateTestReport,
  type TestReport,
  type TestRunRecord
} from './tests'

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
    createdAt: '2026-10-05T10:00:00Z',
    startedAt: '2026-10-05T10:00:00Z',
    updatedAt: '2026-10-05T10:05:00Z',
    jobs: [],
    ...overrides
  }
}

function report(tests: TestReport['tests'], suite = 'unit'): TestReport {
  return {schemaVersion: 1, suite, tests}
}

const pass = (name: string, durationMs = 10) =>
  ({classname: 'pkg', name, status: 'passed', durationMs}) as const
const fail = (name: string, durationMs = 10) =>
  ({classname: 'pkg', name, status: 'failed', durationMs}) as const
const skip = (name: string) =>
  ({classname: 'pkg', name, status: 'skipped', durationMs: 0}) as const

describe('testKey', () => {
  it('joins suite, classname and name', () => {
    expect(testKey('unit', {classname: 'pkg', name: 'adds'})).toBe(
      'unit::pkg::adds'
    )
  })

  it('leaves out an empty classname', () => {
    expect(testKey('unit', {classname: '', name: 'adds'})).toBe('unit::adds')
  })
})

describe('validateTestReport', () => {
  it('accepts a well-formed report', () => {
    expect(validateTestReport(report([pass('a')])).tests).toHaveLength(1)
  })

  it.each([
    ['a non-object', 'nope', /not an object/],
    [
      'another schema version',
      {schemaVersion: 2, suite: 'u', tests: []},
      /version/
    ],
    ['a bad suite label', {schemaVersion: 1, suite: 'a b', tests: []}, /suite/],
    [
      'an unknown status',
      {schemaVersion: 1, suite: 'u', tests: [{...pass('a'), status: 'ok'}]},
      /status/
    ],
    [
      'a negative duration',
      {schemaVersion: 1, suite: 'u', tests: [{...pass('a'), durationMs: -1}]},
      /duration/
    ],
    [
      'an over-long name',
      {schemaVersion: 1, suite: 'u', tests: [pass('x'.repeat(1001))]},
      /name/
    ]
  ])('refuses %s', (_, data, message) => {
    expect(() => validateTestReport(data)).toThrow(message)
  })

  it('refuses more tests than the limit', () => {
    const tests = Array.from({length: 3}, (_, i) => pass(`t${i}`))
    expect(() => validateTestReport(report(tests), {maxTests: 2})).toThrow(
      /more than 2/
    )
  })
})

describe('addReport', () => {
  it('records failures and skips by key, and counts the rest', () => {
    const shard = addReport(
      emptyTestShard('2026-10'),
      run(),
      report([pass('a'), fail('b'), skip('c')])
    )
    expect(shard.runs[0]).toMatchObject({
      runId: 1,
      suite: 'unit',
      total: 3,
      passed: 1,
      failed: ['unit::pkg::b'],
      skipped: ['unit::pkg::c']
    })
  })

  it('adds each test to its day: count, failures, total and max duration', () => {
    let shard = addReport(
      emptyTestShard('2026-10'),
      run(),
      report([pass('a', 10)])
    )
    shard = addReport(shard, run({id: 2}), report([fail('a', 30)]))
    const index = shard.tests.indexOf('unit::pkg::a')
    expect(shard.daily['2026-10-05']?.[index]).toEqual([2, 1, 40, 30])
  })

  it('leaves skipped tests out of the daily numbers', () => {
    const shard = addReport(
      emptyTestShard('2026-10'),
      run(),
      report([skip('c')])
    )
    expect(shard.daily['2026-10-05']).toEqual({})
  })

  it('ignores a report it already has for the same run attempt and suite', () => {
    const once = addReport(
      emptyTestShard('2026-10'),
      run(),
      report([pass('a')])
    )
    const twice = addReport(once, run(), report([pass('a')]))
    expect(twice.runs).toHaveLength(1)
    expect(twice.daily['2026-10-05']?.[0]).toEqual([1, 0, 10, 10])
  })

  it('keeps an earlier attempt when a re-run arrives', () => {
    let shard = addReport(emptyTestShard('2026-10'), run(), report([fail('a')]))
    shard = addReport(shard, run({attempt: 2}), report([pass('a')]))
    expect(shard.runs.map(r => r.attempt)).toEqual([1, 2])
  })
})

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

describe('flakyTests', () => {
  it('flags a test that failed and passed at the same commit', () => {
    const flaky = flakyTests([
      testRun({runId: 1, failed: ['unit::pkg::a'], passed: 1}),
      testRun({runId: 1, attempt: 2})
    ])
    expect(flaky.map(f => [f.key, f.commits])).toEqual([['unit::pkg::a', 1]])
  })

  it('does not flag a test that failed at every run of a commit', () => {
    expect(
      flakyTests([
        testRun({runId: 1, failed: ['unit::pkg::a']}),
        testRun({runId: 2, failed: ['unit::pkg::a']})
      ])
    ).toEqual([])
  })

  it('does not count a run where the test was skipped as a pass', () => {
    expect(
      flakyTests([
        testRun({runId: 1, failed: ['unit::pkg::a']}),
        testRun({runId: 2, skipped: ['unit::pkg::a']})
      ])
    ).toEqual([])
  })

  it('does not compare different commits or different suites', () => {
    expect(
      flakyTests([
        testRun({runId: 1, failed: ['unit::pkg::a']}),
        testRun({runId: 2, headSha: 'b'.repeat(40)}),
        testRun({runId: 3, suite: 'e2e'})
      ])
    ).toEqual([])
  })

  it('counts commits and keeps the runs that show it, most flaky first', () => {
    const sha2 = 'b'.repeat(40)
    const flaky = flakyTests([
      testRun({runId: 1, failed: ['unit::pkg::a', 'unit::pkg::b']}),
      testRun({runId: 2}),
      testRun({runId: 3, headSha: sha2, failed: ['unit::pkg::a']}),
      testRun({runId: 4, headSha: sha2})
    ])
    expect(flaky.map(f => [f.key, f.commits])).toEqual([
      ['unit::pkg::a', 2],
      ['unit::pkg::b', 1]
    ])
    expect(flaky[0]?.failedRuns.map(r => r.runId)).toEqual([1, 3])
  })
})

describe('failingTests', () => {
  it('ranks tests by failures, with the latest failing run', () => {
    const ranked = failingTests([
      testRun({runId: 1, failed: ['unit::pkg::a']}),
      testRun({
        runId: 2,
        failed: ['unit::pkg::a', 'unit::pkg::b'],
        createdAt: '2026-10-06T00:00:00Z'
      })
    ])
    expect(ranked.map(t => [t.key, t.failures, t.lastRunId])).toEqual([
      ['unit::pkg::a', 2, 2],
      ['unit::pkg::b', 1, 2]
    ])
  })
})

describe('testTimings', () => {
  it('ranks tests by mean duration over the days in range', () => {
    let shard = emptyTestShard('2026-10')
    shard = addReport(
      shard,
      run(),
      report([pass('slow', 100), pass('fast', 1)])
    )
    shard = addReport(
      shard,
      run({id: 2, createdAt: '2026-10-06T00:00:00Z'}),
      report([pass('slow', 300)])
    )
    const timings = testTimings([shard], '2026-10-01')
    expect(timings.map(t => [t.key, t.count, t.meanMs, t.maxMs])).toEqual([
      ['unit::pkg::slow', 2, 200, 300],
      ['unit::pkg::fast', 1, 1, 1]
    ])
  })

  it('leaves out days before the start', () => {
    const shard = addReport(
      emptyTestShard('2026-10'),
      run(),
      report([pass('a')])
    )
    expect(testTimings([shard], '2026-10-06')).toEqual([])
  })
})

describe('testHistory', () => {
  it('gives one test per day across shards, oldest first', () => {
    let sep = addReport(
      emptyTestShard('2026-09'),
      run({createdAt: '2026-09-30T00:00:00Z'}),
      report([fail('a', 50)])
    )
    let oct = addReport(
      emptyTestShard('2026-10'),
      run({id: 2}),
      report([pass('a', 10)])
    )
    oct = addReport(oct, run({id: 3}), report([pass('b')]))
    sep = {...sep}
    expect(testHistory([oct, sep], 'unit::pkg::a')).toEqual([
      {date: '2026-09-30', count: 1, failures: 1, meanMs: 50, maxMs: 50},
      {date: '2026-10-05', count: 1, failures: 0, meanMs: 10, maxMs: 10}
    ])
  })
})
