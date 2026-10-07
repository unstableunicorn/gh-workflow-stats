// One workflow: filters in the URL, linked zoomable charts, and tables that
// carry the same data as the charts.

import {useEffect, useMemo, useState} from 'preact/hooks'
import type {RunRecord, Summary} from '@gh-workflow-stats/core'
import {Chart} from './Chart'
import {PeriodSelect} from './PeriodSelect'
import {
  dailyChart,
  dailyTooltipRows,
  durationChart,
  tooltipRows,
  type ScatterDatum
} from '../lib/charts'
import {loadRuns, monthsToLoad, rangeFor, type FetchJson} from '../lib/data'
import {formatDuration, formatPercent, runUrl} from '../lib/format'
import {formatRoute, type Route} from '../lib/route'
import {durationPoints, workflowView} from '../lib/workflow'
import {readTheme} from '../theme'
import './workflow.css'

type WorkflowRoute = Extract<Route, {view: 'workflow'}>

interface Props {
  route: WorkflowRoute
  summary: Summary
  fetchJson: FetchJson
  now: Date
}

const RECENT_ROWS = 50

function isScatterDatum(data: unknown): data is ScatterDatum {
  return typeof (data as ScatterDatum | null)?.runId === 'number'
}

export function WorkflowPage({route, summary, fetchJson, now}: Props) {
  const [runs, setRuns] = useState<RunRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workflow = summary.workflows.find(w => w.id === route.id)
  const range = useMemo(() => rangeFor(route.days, now), [route.days, now])
  const months = monthsToLoad(range, summary.months).join(',')

  useEffect(() => {
    setRuns(null)
    loadRuns(fetchJson, months === '' ? [] : months.split(','))
      .then(setRuns)
      .catch((e: unknown) => setError(String(e)))
  }, [fetchJson, months])

  const view = useMemo(
    () =>
      runs === null
        ? null
        : workflowView(runs, {
            workflowId: route.id,
            ...(range.from === undefined ? {} : {from: range.from}),
            ...(route.branch === undefined ? {} : {branch: route.branch})
          }),
    [runs, route.id, route.branch, range]
  )
  const theme = useMemo(readTheme, [])
  const durations = useMemo(
    () =>
      view === null ? null : durationChart(durationPoints(view.runs), theme),
    [view, theme]
  )
  const daily = useMemo(
    () => (view === null ? null : dailyChart(view.daily, theme)),
    [view, theme]
  )
  const rows = useMemo(
    () => (data: unknown) =>
      isScatterDatum(data) ? tooltipRows(data.point) : null,
    []
  )
  const openRun = useMemo(
    () => (data: unknown) => {
      const url = isScatterDatum(data)
        ? runUrl(summary.repository, data.runId)
        : null
      if (url !== null) window.open(url, '_blank', 'noopener,noreferrer')
    },
    [summary.repository]
  )

  const navigate = (change: Partial<WorkflowRoute>) => {
    const next = {...route, ...change}
    if (change.branch === undefined && 'branch' in change) delete next.branch
    location.hash = formatRoute(next)
  }

  if (workflow === undefined)
    return (
      <p>
        No workflow with id {route.id}. <a href="#/">Back to all workflows</a>
      </p>
    )

  return (
    <section aria-labelledby="workflow-title">
      <p>
        <a href="#/">All workflows</a>
      </p>
      <h2 id="workflow-title">{workflow.name}</h2>
      <form class="filters" onSubmit={e => e.preventDefault()}>
        <label>
          Branch{' '}
          <select
            value={route.branch ?? ''}
            onChange={e => {
              const value = e.currentTarget.value
              navigate({branch: value === '' ? undefined : value})
            }}
          >
            <option value="">All branches</option>
            {(view?.branches ?? (route.branch ? [route.branch] : [])).map(b => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <PeriodSelect value={route.days} onChange={days => navigate({days})} />
      </form>

      {error !== null && <p class="notice">Could not load runs: {error}</p>}
      {view === null && error === null && (
        <p aria-live="polite">Loading runs…</p>
      )}
      {view !== null && view.runs.length === 0 && (
        <p>No completed runs match these filters.</p>
      )}
      {view !== null && view.runs.length > 0 && durations && daily && (
        <>
          <p class="muted">
            Drag or scroll on a chart to zoom; both charts follow. Select a
            point to open the run on GitHub.
          </p>
          <h3>Run duration</h3>
          <Chart
            option={durations}
            label={`Duration of ${view.runs.length} runs over time. The same runs are listed in the recent runs table.`}
            group="workflow"
            rows={rows}
            onItemClick={openRun}
          />
          <h3>Runs and success rate per day</h3>
          <Chart
            option={daily}
            label="Runs per day and daily success rate. The same numbers are in the daily table."
            group="workflow"
            rows={dailyTooltipRows}
          />

          <div class="table-scroll">
            <table>
              <caption>Per day</caption>
              <thead>
                <tr>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col" class="num">
                    Runs
                  </th>
                  <th scope="col" class="num">
                    Success rate
                  </th>
                  <th scope="col" class="num">
                    Duration p50
                  </th>
                  <th scope="col" class="num">
                    Duration p95
                  </th>
                  <th scope="col" class="num">
                    Queue p50
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...view.daily].reverse().map(d => (
                  <tr key={d.date}>
                    <th scope="row">{d.date}</th>
                    <td class="num">{d.stats.runs}</td>
                    <td class="num">{formatPercent(d.stats.successRate)}</td>
                    <td class="num">{formatDuration(d.stats.durationP50Ms)}</td>
                    <td class="num">{formatDuration(d.stats.durationP95Ms)}</td>
                    <td class="num">{formatDuration(d.stats.queueP50Ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="table-scroll">
            <table>
              <caption>Slowest jobs</caption>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col" class="num">
                    Runs
                  </th>
                  <th scope="col" class="num">
                    p50
                  </th>
                  <th scope="col" class="num">
                    p95
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.slowest.map(j => (
                  <tr key={j.name}>
                    <th scope="row">{j.name}</th>
                    <td class="num">{j.count}</td>
                    <td class="num">{formatDuration(j.p50Ms)}</td>
                    <td class="num">{formatDuration(j.p95Ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="table-scroll">
            <table>
              <caption>
                Recent runs (latest {Math.min(RECENT_ROWS, view.runs.length)})
              </caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Started (UTC)</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {view.runs
                  .slice(-RECENT_ROWS)
                  .reverse()
                  .map(r => {
                    const url = runUrl(summary.repository, r.id)
                    return (
                      <tr key={r.id}>
                        <th scope="row">
                          {url === null ? (
                            `#${r.id}`
                          ) : (
                            <a href={url} rel="noopener noreferrer">
                              #{r.id}
                            </a>
                          )}
                        </th>
                        <td>{r.createdAt.replace('T', ' ').slice(0, 16)}</td>
                        <td>{r.branch ?? '—'}</td>
                        <td>{r.conclusion ?? 'unknown'}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
