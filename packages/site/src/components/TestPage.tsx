// One test: its duration and failures per day, and the runs it failed in.

import {useEffect, useMemo, useState} from 'preact/hooks'
import type {Summary, TestShard} from '@gh-workflow-stats/core'
import {Chart} from './Chart'
import {PeriodSelect} from './PeriodSelect'
import {RunLink} from './TestsPage'
import {seriesTooltipRows, testHistoryChart} from '../lib/charts'
import {
  loadTestShards,
  monthsToLoad,
  rangeFor,
  type FetchJson
} from '../lib/data'
import {formatDuration} from '../lib/format'
import {formatRoute, type Route} from '../lib/route'
import {displayName, testDetail} from '../lib/tests'
import {readTheme} from '../theme'
import './workflow.css'

type TestRoute = Extract<Route, {view: 'test'}>

interface Props {
  route: TestRoute
  summary: Summary
  fetchJson: FetchJson
  now: Date
}

const historyRows = seriesTooltipRows(['Mean (s)', 'Max (s)', 'Failures'])

export function TestPage({route, summary, fetchJson, now}: Props) {
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

  const detail = useMemo(
    () => (shards === null ? null : testDetail(shards, route.key, range.from)),
    [shards, route.key, range]
  )
  const theme = useMemo(readTheme, [])
  const chart = useMemo(
    () => (detail === null ? null : testHistoryChart(detail.history, theme)),
    [detail, theme]
  )
  const {suite, name} = displayName(route.key)

  return (
    <section aria-labelledby="test-title">
      <p>
        <a href={formatRoute({view: 'tests', suite, days: route.days})}>
          All tests in {suite}
        </a>
      </p>
      <h2 id="test-title" class="test-name">
        {name}
      </h2>
      <form class="filters" onSubmit={e => e.preventDefault()}>
        <PeriodSelect
          value={route.days}
          onChange={days => {
            location.hash = formatRoute({...route, days})
          }}
        />
      </form>

      {error !== null && (
        <p class="notice">Could not load test results: {error}</p>
      )}
      {detail === null && error === null && (
        <p aria-live="polite">Loading test results…</p>
      )}
      {detail !== null && detail.history.length === 0 && (
        <p>This test has no results in this period.</p>
      )}
      {detail !== null && detail.history.length > 0 && chart !== null && (
        <>
          <h3>Duration and failures per day</h3>
          <Chart
            option={chart}
            label={`Mean and maximum duration and failures per day for ${name}. The same numbers are in the daily table.`}
            rows={historyRows}
          />

          <div class="table-scroll">
            <table>
              <caption>Failed runs</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Started (UTC)</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Commit</th>
                </tr>
              </thead>
              <tbody>
                {detail.failures.length === 0 && (
                  <tr>
                    <td colSpan={4}>No failures in this period.</td>
                  </tr>
                )}
                {detail.failures.map(r => (
                  <tr key={`${r.runId}-${r.attempt}`}>
                    <th scope="row">
                      <RunLink
                        repository={summary.repository}
                        runId={r.runId}
                      />
                      {r.attempt > 1 ? ` (attempt ${r.attempt})` : ''}
                    </th>
                    <td>{r.createdAt.replace('T', ' ').slice(0, 16)}</td>
                    <td>{r.branch ?? '—'}</td>
                    <td>
                      <code>{r.headSha.slice(0, 8)}</code>
                    </td>
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
                    Executions
                  </th>
                  <th scope="col" class="num">
                    Failures
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
                {[...detail.history].reverse().map(d => (
                  <tr key={d.date}>
                    <th scope="row">{d.date}</th>
                    <td class="num">{d.count}</td>
                    <td class="num">{d.failures}</td>
                    <td class="num">{formatDuration(d.meanMs)}</td>
                    <td class="num">{formatDuration(d.maxMs)}</td>
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
