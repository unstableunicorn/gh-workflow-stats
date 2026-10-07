// ECharts options for the workflow view, built from data and theme colours.
// Options hold no HTML: tooltips are built as DOM text from tooltipRows().

import type {DayStats, TestDay} from '@gh-workflow-stats/core'
import {formatDuration} from './format'
import type {DurationPoint, Outcome} from './workflow'

/** Colours read from the page's CSS custom properties. */
export interface Theme {
  text: string
  grid: string
  success: string
  failure: string
  other: string
  accent: string
}

const OUTCOME_NAMES: Record<Outcome, string> = {
  success: 'Succeeded',
  failure: 'Failed',
  other: 'Cancelled or skipped'
}

/** A scatter point; `runId` drives the drill-down to the run on GitHub. */
export interface ScatterDatum {
  value: [string, number]
  runId: number
  point: DurationPoint
}

function axes(theme: Theme, yName: string) {
  const line = {lineStyle: {color: theme.grid}}
  return {
    textStyle: {color: theme.text},
    grid: {left: 56, right: 56, top: 40, bottom: 72},
    xAxis: {
      type: 'time' as const,
      axisLine: line,
      axisLabel: {color: theme.text}
    },
    yAxis: {
      type: 'value' as const,
      name: yName,
      nameTextStyle: {color: theme.text},
      axisLabel: {color: theme.text},
      splitLine: line
    },
    legend: {top: 0, textStyle: {color: theme.text}},
    dataZoom: [
      {type: 'inside' as const, xAxisIndex: 0},
      {type: 'slider' as const, xAxisIndex: 0, bottom: 16}
    ],
    aria: {enabled: true}
  }
}

/** Run duration over time, one series per outcome, zoomable along time. */
export function durationChart(
  groups: {outcome: Outcome; points: DurationPoint[]}[],
  theme: Theme
) {
  return {
    ...axes(theme, 'Minutes'),
    tooltip: {trigger: 'item' as const},
    series: groups.map(g => ({
      name: OUTCOME_NAMES[g.outcome],
      type: 'scatter' as const,
      symbolSize: 8,
      itemStyle: {color: theme[g.outcome]},
      data: g.points.map((p): ScatterDatum => ({
        value: [p.createdAt, p.durationMs / 60_000],
        runId: p.id,
        point: p
      }))
    }))
  }
}

/** Runs per day as bars and the success rate (%) as a line on a second axis. */
export function dailyChart(days: DayStats[], theme: Theme) {
  const base = axes(theme, 'Runs')
  return {
    ...base,
    tooltip: {trigger: 'axis' as const},
    yAxis: [
      base.yAxis,
      {
        ...base.yAxis,
        name: 'Success %',
        min: 0,
        max: 100,
        splitLine: {show: false}
      }
    ],
    series: [
      {
        name: 'Runs',
        type: 'bar' as const,
        itemStyle: {color: theme.accent},
        data: days.map(d => [d.date, d.stats.runs] as [string, number])
      },
      {
        name: 'Success rate',
        type: 'line' as const,
        yAxisIndex: 1,
        itemStyle: {color: theme.success},
        connectNulls: false,
        data: days.map(
          d =>
            [
              d.date,
              d.stats.successRate === null
                ? null
                : Math.round(d.stats.successRate * 100)
            ] as [string, number | null]
        )
      }
    ]
  }
}

/** Label and value pairs for a point's tooltip, to be set as text. */
export function tooltipRows(
  point: DurationPoint
): {label: string; value: string}[] {
  return [
    {label: 'Run', value: `#${point.id}`},
    {label: 'Branch', value: point.branch ?? '—'},
    {label: 'Result', value: point.conclusion ?? 'unknown'},
    {label: 'Duration', value: formatDuration(point.durationMs)},
    {label: 'Started', value: point.createdAt.replace('T', ' ').slice(0, 16)}
  ]
}

/** Tooltip rows for a day of dailyChart: its `[date, value]` pairs, in series order. */
export function dailyTooltipRows(
  data: unknown
): {label: string; value: string}[] | null {
  if (!Array.isArray(data) || data.length !== 2) return null
  const [runs, rate] = data as [unknown, unknown]
  if (!Array.isArray(runs) || !Array.isArray(rate)) return null
  return [
    {label: 'Date', value: String(runs[0])},
    {label: 'Runs', value: String(runs[1])},
    {
      label: 'Success rate',
      value: rate[1] === null ? '—' : `${String(rate[1])}%`
    }
  ]
}

/** Test executions per day as bars and failures as a line on a second axis. */
export function testsDailyChart(
  days: {date: string; executions: number; failures: number}[],
  theme: Theme
) {
  const base = axes(theme, 'Executions')
  return {
    ...base,
    tooltip: {trigger: 'axis' as const},
    yAxis: [
      base.yAxis,
      {
        ...base.yAxis,
        name: 'Failures',
        minInterval: 1,
        splitLine: {show: false}
      }
    ],
    series: [
      {
        name: 'Test executions',
        type: 'bar' as const,
        itemStyle: {color: theme.accent},
        data: days.map(d => [d.date, d.executions] as [string, number])
      },
      {
        name: 'Failures',
        type: 'line' as const,
        yAxisIndex: 1,
        itemStyle: {color: theme.failure},
        data: days.map(d => [d.date, d.failures] as [string, number])
      }
    ]
  }
}

/** One test's mean and max duration (seconds) per day, with failures as bars. */
export function testHistoryChart(days: TestDay[], theme: Theme) {
  const base = axes(theme, 'Seconds')
  const seconds = (ms: number) => ms / 1000
  return {
    ...base,
    tooltip: {trigger: 'axis' as const},
    yAxis: [
      base.yAxis,
      {
        ...base.yAxis,
        name: 'Failures',
        minInterval: 1,
        splitLine: {show: false}
      }
    ],
    series: [
      {
        name: 'Mean',
        type: 'line' as const,
        itemStyle: {color: theme.accent},
        data: days.map(d => [d.date, seconds(d.meanMs)] as [string, number])
      },
      {
        name: 'Max',
        type: 'line' as const,
        itemStyle: {color: theme.other},
        data: days.map(d => [d.date, seconds(d.maxMs)] as [string, number])
      },
      {
        name: 'Failures',
        type: 'bar' as const,
        yAxisIndex: 1,
        itemStyle: {color: theme.failure},
        data: days.map(d => [d.date, d.failures] as [string, number])
      }
    ]
  }
}

/** Tooltip rows for an axis tooltip over `[date, value]` series named `names`. */
export function seriesTooltipRows(names: string[]) {
  return (data: unknown): {label: string; value: string}[] | null => {
    if (!Array.isArray(data) || data.length !== names.length) return null
    const points = data as unknown[]
    const first = points[0]
    if (!Array.isArray(first)) return null
    return [
      {label: 'Date', value: String(first[0])},
      ...points.map((p, i) => ({
        label: names[i] ?? '',
        value: Array.isArray(p) && p[1] !== null ? String(p[1]) : '—'
      }))
    ]
  }
}
