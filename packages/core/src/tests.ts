// Test results: the report the report Action uploads, how the collector stores
// it (monthly shards of failures and daily per-test numbers), and flaky detection.

import type {RunRecord} from './schema'

export const TEST_SCHEMA_VERSION = 1
/** Report artifacts are named this prefix plus the suite label. */
export const TEST_ARTIFACT_PREFIX = 'gh-workflow-stats-tests-'
export const SUITE_LABEL = /^[A-Za-z0-9._-]{1,64}$/

export type TestStatus = 'passed' | 'failed' | 'skipped'

export interface TestCase {
  classname: string
  name: string
  status: TestStatus
  durationMs: number
}

/** One suite's results from one job: the report artifact's content. */
export interface TestReport {
  schemaVersion: typeof TEST_SCHEMA_VERSION
  suite: string
  tests: TestCase[]
}

/** One suite's results in one run attempt; failed and skipped hold test keys. */
export interface TestRunRecord {
  runId: number
  attempt: number
  suite: string
  headSha: string
  branch: string | null
  workflowId: number
  createdAt: string
  total: number
  passed: number
  failed: string[]
  skipped: string[]
}

/** Per test per day: [executions, failures, total ms, max ms]. */
export type DayNumbers = [number, number, number, number]

/** One month of test results: `tests/YYYY-MM.json`. */
export interface TestShard {
  schemaVersion: typeof TEST_SCHEMA_VERSION
  month: string
  /** Test keys; `daily` refers to them by index. */
  tests: string[]
  runs: TestRunRecord[]
  /** Date → test index → numbers. */
  daily: Record<string, Record<string, DayNumbers>>
}

export const testPaths = {
  shard: (month: string): string => `tests/${month}.json`
}

const STATUSES = new Set<string>(['passed', 'failed', 'skipped'])
const MAX_TEXT = 1000

/** A test's identity across runs: suite, classname and name. */
export function testKey(
  suite: string,
  test: Pick<TestCase, 'classname' | 'name'>
): string {
  return test.classname === ''
    ? `${suite}::${test.name}`
    : `${suite}::${test.classname}::${test.name}`
}

/** Checks untrusted report data field by field; throws on anything unexpected. */
export function validateTestReport(
  data: unknown,
  limits = {maxTests: 200_000}
): TestReport {
  if (typeof data !== 'object' || data === null)
    throw new Error('Test report is not an object')
  const r = data as Partial<TestReport>
  if (r.schemaVersion !== TEST_SCHEMA_VERSION)
    throw new Error(
      `Test report has schema version ${String(r.schemaVersion)}; expected ${TEST_SCHEMA_VERSION}`
    )
  if (typeof r.suite !== 'string' || !SUITE_LABEL.test(r.suite))
    throw new Error(
      `Test report suite label is not valid: ${JSON.stringify(r.suite)}`
    )
  if (!Array.isArray(r.tests)) throw new Error('Test report has no tests array')
  if (r.tests.length > limits.maxTests)
    throw new Error(`Test report has more than ${limits.maxTests} tests`)
  const text = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.length > MAX_TEXT)
      throw new Error(
        `Test ${field} must be a string of at most ${MAX_TEXT} characters`
      )
    return value
  }
  const tests = r.tests.map((t: Partial<TestCase>): TestCase => {
    if (typeof t.status !== 'string' || !STATUSES.has(t.status))
      throw new Error(
        `Test status is not passed, failed or skipped: ${JSON.stringify(t.status)}`
      )
    if (
      typeof t.durationMs !== 'number' ||
      !Number.isFinite(t.durationMs) ||
      t.durationMs < 0
    )
      throw new Error(
        `Test duration is not a non-negative number: ${String(t.durationMs)}`
      )
    return {
      classname: text(t.classname, 'classname'),
      name: text(t.name, 'name'),
      status: t.status as TestStatus,
      durationMs: t.durationMs
    }
  })
  return {schemaVersion: TEST_SCHEMA_VERSION, suite: r.suite, tests}
}

/** A month with no results yet. */
export function emptyTestShard(month: string): TestShard {
  return {
    schemaVersion: TEST_SCHEMA_VERSION,
    month,
    tests: [],
    runs: [],
    daily: {}
  }
}

/** Adds one report for one run attempt; a report already held is ignored. */
export function addReport(
  shard: TestShard,
  run: RunRecord,
  report: TestReport
): TestShard {
  const held = shard.runs.some(
    r =>
      r.runId === run.id &&
      r.attempt === run.attempt &&
      r.suite === report.suite
  )
  if (held) return shard

  const tests = [...shard.tests]
  const indexOf = new Map(tests.map((k, i) => [k, i]))
  const date = new Date(Date.parse(run.createdAt)).toISOString().slice(0, 10)
  const day = {...(shard.daily[date] ?? {})}
  const failed: string[] = []
  const skipped: string[] = []

  for (const t of report.tests) {
    const key = testKey(report.suite, t)
    if (t.status === 'skipped') {
      skipped.push(key)
      continue
    }
    if (t.status === 'failed') failed.push(key)
    let index = indexOf.get(key)
    if (index === undefined) {
      index = tests.push(key) - 1
      indexOf.set(key, index)
    }
    const [count, failures, total, max] = day[index] ?? [0, 0, 0, 0]
    const ms = Math.round(t.durationMs)
    day[index] = [
      count + 1,
      failures + (t.status === 'failed' ? 1 : 0),
      total + ms,
      Math.max(max, ms)
    ]
  }

  const record: TestRunRecord = {
    runId: run.id,
    attempt: run.attempt,
    suite: report.suite,
    headSha: run.headSha,
    branch: run.branch,
    workflowId: run.workflowId,
    createdAt: run.createdAt,
    total: report.tests.length,
    passed: report.tests.length - failed.length - skipped.length,
    failed,
    skipped
  }
  return {
    ...shard,
    tests,
    runs: [...shard.runs, record],
    daily: {...shard.daily, [date]: day}
  }
}

export interface FlakyTest {
  key: string
  /** Commits at which the test both passed and failed. */
  commits: number
  failedRuns: TestRunRecord[]
  lastSeen: string
}

/** Tests that passed and failed at the same commit and suite, most flaky first. */
export function flakyTests(runs: TestRunRecord[]): FlakyTest[] {
  const groups = new Map<string, TestRunRecord[]>()
  for (const r of runs) {
    const id = `${r.headSha}|${r.suite}`
    groups.set(id, [...(groups.get(id) ?? []), r])
  }
  const found = new Map<string, FlakyTest>()
  for (const group of groups.values()) {
    for (const key of new Set(group.flatMap(r => r.failed))) {
      const passedSomewhere = group.some(
        r => !r.failed.includes(key) && !r.skipped.includes(key)
      )
      if (!passedSomewhere) continue
      const failedRuns = group.filter(r => r.failed.includes(key))
      const entry = found.get(key) ?? {
        key,
        commits: 0,
        failedRuns: [],
        lastSeen: ''
      }
      entry.commits++
      entry.failedRuns.push(...failedRuns)
      for (const r of group)
        if (r.createdAt > entry.lastSeen) entry.lastSeen = r.createdAt
      found.set(key, entry)
    }
  }
  return [...found.values()]
    .map(f => ({
      ...f,
      failedRuns: [...f.failedRuns].sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId - b.runId
      )
    }))
    .sort((a, b) => b.commits - a.commits || a.key.localeCompare(b.key))
}

export interface FailingTest {
  key: string
  failures: number
  lastRunId: number
  lastFailed: string
}

/** Tests ranked by how many runs they failed in, with the latest failure. */
export function failingTests(runs: TestRunRecord[]): FailingTest[] {
  const found = new Map<string, FailingTest>()
  for (const r of runs)
    for (const key of r.failed) {
      const entry = found.get(key) ?? {
        key,
        failures: 0,
        lastRunId: r.runId,
        lastFailed: r.createdAt
      }
      entry.failures++
      if (r.createdAt >= entry.lastFailed) {
        entry.lastFailed = r.createdAt
        entry.lastRunId = r.runId
      }
      found.set(key, entry)
    }
  return [...found.values()].sort(
    (a, b) => b.failures - a.failures || a.key.localeCompare(b.key)
  )
}

export interface TestTiming {
  key: string
  count: number
  failures: number
  meanMs: number
  maxMs: number
}

/** Per test over days on or after `fromDate` (YYYY-MM-DD), slowest mean first. */
export function testTimings(
  shards: TestShard[],
  fromDate: string
): TestTiming[] {
  const totals = new Map<string, DayNumbers>()
  for (const shard of shards)
    for (const [date, day] of Object.entries(shard.daily)) {
      if (date < fromDate) continue
      for (const [index, [count, failures, total, max]] of Object.entries(
        day
      )) {
        const key = shard.tests[Number(index)]
        if (key === undefined) continue
        const [c, f, t, m] = totals.get(key) ?? [0, 0, 0, 0]
        totals.set(key, [c + count, f + failures, t + total, Math.max(m, max)])
      }
    }
  return [...totals.entries()]
    .map(([key, [count, failures, total, max]]) => ({
      key,
      count,
      failures,
      meanMs: Math.round(total / count),
      maxMs: max
    }))
    .sort((a, b) => b.meanMs - a.meanMs || a.key.localeCompare(b.key))
}

export interface TestDay {
  date: string
  count: number
  failures: number
  meanMs: number
  maxMs: number
}

/** One test's numbers per day across shards, oldest first. */
export function testHistory(shards: TestShard[], key: string): TestDay[] {
  const days: TestDay[] = []
  for (const shard of shards) {
    const index = shard.tests.indexOf(key)
    if (index === -1) continue
    for (const [date, day] of Object.entries(shard.daily)) {
      const numbers = day[index]
      if (numbers === undefined) continue
      const [count, failures, total, max] = numbers
      days.push({
        date,
        count,
        failures,
        meanMs: Math.round(total / count),
        maxMs: max
      })
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date))
}
