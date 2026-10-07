// What the test views show: runs under the URL's filters, flaky, failing and
// slow tests, the daily trend, and one test's history.

import {
  failingTests,
  flakyTests,
  testHistory,
  testTimings,
  type FailingTest,
  type FlakyTest,
  type TestDay,
  type TestRunRecord,
  type TestShard,
  type TestTiming
} from '@gh-workflow-stats/core'

const TOP = 20

export interface TestsFilter {
  from?: string
  suite?: string
}

export interface TestsView {
  runs: TestRunRecord[]
  suites: string[]
  flaky: FlakyTest[]
  failing: FailingTest[]
  slowest: TestTiming[]
  daily: {date: string; executions: number; failures: number}[]
}

function inRange(createdAt: string, from: string | undefined): boolean {
  return from === undefined || Date.parse(createdAt) >= Date.parse(from)
}

/** The tests overview for a suite (or all) from `from` onwards. */
export function testsView(shards: TestShard[], filter: TestsFilter): TestsView {
  const ranged = shards
    .flatMap(s => s.runs)
    .filter(r => inRange(r.createdAt, filter.from))
  const runs =
    filter.suite === undefined
      ? ranged
      : ranged.filter(r => r.suite === filter.suite)
  const prefix = filter.suite === undefined ? '' : `${filter.suite}::`
  const fromDate = filter.from?.slice(0, 10) ?? ''

  const byDay = new Map<string, {executions: number; failures: number}>()
  for (const shard of shards)
    for (const [date, day] of Object.entries(shard.daily)) {
      if (date < fromDate) continue
      for (const [index, [count, failures]] of Object.entries(day)) {
        if (!(shard.tests[Number(index)] ?? '').startsWith(prefix)) continue
        const total = byDay.get(date) ?? {executions: 0, failures: 0}
        byDay.set(date, {
          executions: total.executions + count,
          failures: total.failures + failures
        })
      }
    }

  return {
    runs,
    suites: [...new Set(ranged.map(r => r.suite))].sort(),
    flaky: flakyTests(runs).slice(0, TOP),
    failing: failingTests(runs).slice(0, TOP),
    slowest: testTimings(shards, fromDate)
      .filter(t => t.key.startsWith(prefix))
      .slice(0, TOP),
    daily: [...byDay.entries()]
      .map(([date, totals]) => ({date, ...totals}))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
}

export interface TestDetail {
  history: TestDay[]
  failures: TestRunRecord[]
}

/** One test's daily numbers and failing runs (newest first) from `from` onwards. */
export function testDetail(
  shards: TestShard[],
  key: string,
  from?: string
): TestDetail {
  const fromDate = from?.slice(0, 10) ?? ''
  return {
    history: testHistory(shards, key).filter(d => d.date >= fromDate),
    failures: shards
      .flatMap(s => s.runs)
      .filter(r => r.failed.includes(key) && inRange(r.createdAt, from))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
}

/** A test key split into its suite and the rest, for display. */
export function displayName(key: string): {suite: string; name: string} {
  const at = key.indexOf('::')
  return at === -1
    ? {suite: '', name: key}
    : {suite: key.slice(0, at), name: key.slice(at + 2)}
}
