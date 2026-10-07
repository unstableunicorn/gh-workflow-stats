// Test results across runs: daily trend, flaky, failing and slowest tests,
// filtered by suite and period from the URL.

import {useEffect, useMemo, useState} from 'preact/hooks'
import type {Summary, TestShard} from '@gh-workflow-stats/core'
import {Chart} from './Chart'
import {PeriodSelect} from './PeriodSelect'
import {seriesTooltipRows, testsDailyChart} from '../lib/charts'
import {
  loadTestShards,
  monthsToLoad,
  rangeFor,
  type FetchJson
} from '../lib/data'
import {formatDuration, runUrl} from '../lib/format'
import {formatRoute, type Days, type Route} from '../lib/route'
import {displayName, testsView} from '../lib/tests'
import {readTheme} from '../theme'
import './workflow.css'

type TestsRoute = Extract<Route, {view: 'tests'}>

interface Props {
  route: TestsRoute
  summary: Summary
  fetchJson: FetchJson
  now: Date
}

const dailyRows = seriesTooltipRows(['Test executions', 'Failures'])

/** A link to one test's page, showing its name without the suite. */
export function TestLink({testKey, days}: {testKey: string; days: Days}) {
  return (
    <a href={formatRoute({view: 'test', key: testKey, days})}>
      {displayName(testKey).name}
    </a>
  )
}

/** A link to a run on GitHub, or its number when no safe link can be built. */
export function RunLink({
  repository,
  runId
}: {
  repository: string
  runId: number
}) {
  const url = runUrl(repository, runId)
  return url === null ? (
    <>#{runId}</>
  ) : (
    <a href={url} rel="noopener noreferrer">
      #{runId}
    </a>
  )
}

export function TestsPage({route, summary, fetchJson, now}: Props) {
  const [shards, setShards] = useState<TestShard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const range = useMemo(() => rangeFor(route.days, now), [route.days, now])
  const months = monthsToLoad(range, summary.tests?.months ?? []).join(',')

  useEffect(() => {
    setShards(null)
    loadTestShards(fetchJson, months === '' ? [] : months.split(','))
      .then(setShards)
      .catch((e: unknown) => setError(String(e)))
  }, [fetchJson, months])

  const view = useMemo(
    () =>
      shards === null
        ? null
        : testsView(shards, {
            ...(range.from === undefined ? {} : {from: range.from}),
            ...(route.suite === undefined ? {} : {suite: route.suite})
          }),
    [shards, range, route.suite]
  )
  const theme = useMemo(readTheme, [])
  const chart = useMemo(
    () => (view === null ? null : testsDailyChart(view.daily, theme)),
    [view, theme]
  )
  const navigate = (change: Partial<TestsRoute>) => {
    const next = {...route, ...change}
    if ('suite' in change && change.suite === undefined) delete next.suite
    location.hash = formatRoute(next)
  }

  if (summary.tests === undefined)
    return (
      <p>
        No test reports have been collected yet. Add the report step to a test
        job; see the README.
      </p>
    )

  const suites = view?.suites ?? summary.tests.suites.map(s => s.suite)
  return (
    <section aria-labelledby="tests-title">
      <h2 id="tests-title">Tests</h2>
      <form class="filters" onSubmit={e => e.preventDefault()}>
        <label>
          Suite{' '}
          <select
            value={route.suite ?? ''}
            onChange={e => {
              const value = e.currentTarget.value
              navigate({suite: value === '' ? undefined : value})
            }}
          >
            <option value="">All suites</option>
            {[
              ...new Set([...suites, ...(route.suite ? [route.suite] : [])])
            ].map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <PeriodSelect value={route.days} onChange={days => navigate({days})} />
      </form>

      {error !== null && (
        <p class="notice">Could not load test results: {error}</p>
      )}
      {view === null && error === null && (
        <p aria-live="polite">Loading test results…</p>
      )}
      {view !== null && view.runs.length === 0 && (
        <p>No test reports match these filters.</p>
      )}
      {view !== null && view.runs.length > 0 && chart !== null && (
        <>
          <h3>Test executions and failures per day</h3>
          <Chart
            option={chart}
            label="Test executions and failures per day. The same numbers are in the daily table."
            rows={dailyRows}
          />

          <div class="table-scroll">
            <table>
              <caption>
                Flaky tests: passed and failed at the same commit
              </caption>
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Suite</th>
                  <th scope="col" class="num">
                    Commits
                  </th>
                  <th scope="col">Failed in</th>
                </tr>
              </thead>
              <tbody>
                {view.flaky.length === 0 && (
                  <tr>
                    <td colSpan={4}>No flaky tests in this period.</td>
                  </tr>
                )}
                {view.flaky.map(f => (
                  <tr key={f.key}>
                    <th scope="row">
                      <TestLink testKey={f.key} days={route.days} />
                    </th>
                    <td>{displayName(f.key).suite}</td>
                    <td class="num">{f.commits}</td>
                    <td>
                      {f.failedRuns.slice(-3).map(r => (
                        <span key={`${r.runId}-${r.attempt}`}>
                          <RunLink
                            repository={summary.repository}
                            runId={r.runId}
                          />{' '}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="table-scroll">
            <table>
              <caption>Most failing tests</caption>
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Suite</th>
                  <th scope="col" class="num">
                    Failed runs
                  </th>
                  <th scope="col">Last failed</th>
                </tr>
              </thead>
              <tbody>
                {view.failing.length === 0 && (
                  <tr>
                    <td colSpan={4}>No failures in this period.</td>
                  </tr>
                )}
                {view.failing.map(f => (
                  <tr key={f.key}>
                    <th scope="row">
                      <TestLink testKey={f.key} days={route.days} />
                    </th>
                    <td>{displayName(f.key).suite}</td>
                    <td class="num">{f.failures}</td>
                    <td>
                      <RunLink
                        repository={summary.repository}
                        runId={f.lastRunId}
                      />{' '}
                      {f.lastFailed.replace('T', ' ').slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="table-scroll">
            <table>
              <caption>Slowest tests (mean duration)</caption>
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Suite</th>
                  <th scope="col" class="num">
                    Executions
                  </th>
                  <th scope="col" class="num">
                    Mean
                  </th>
                  <th scope="col" class="num">
                    Max
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.slowest.map(t => (
                  <tr key={t.key}>
                    <th scope="row">
                      <TestLink testKey={t.key} days={route.days} />
                    </th>
                    <td>{displayName(t.key).suite}</td>
                    <td class="num">{t.count}</td>
                    <td class="num">{formatDuration(t.meanMs)}</td>
                    <td class="num">{formatDuration(t.maxMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="table-scroll">
            <table>
              <caption>Per day</caption>
              <thead>
                <tr>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col" class="num">
                    Test executions
                  </th>
                  <th scope="col" class="num">
                    Failures
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...view.daily].reverse().map(d => (
                  <tr key={d.date}>
                    <th scope="row">{d.date}</th>
                    <td class="num">{d.executions}</td>
                    <td class="num">{d.failures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
