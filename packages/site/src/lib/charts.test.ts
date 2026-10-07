import {describe, expect, it} from 'vitest'
import type {DayStats} from '@gh-workflow-stats/core'
import {
  dailyChart,
  dailyTooltipRows,
  durationChart,
  tooltipRows,
  type Theme
} from './charts'

const theme: Theme = {
  text: '#111',
  grid: '#ddd',
  success: 'green',
  failure: 'red',
  other: 'grey',
  accent: 'blue'
}

const point = {
  id: 7,
  createdAt: '2026-10-05T10:00:00Z',
  durationMs: 125_000,
  branch: '<img src=x onerror=alert(1)>',
  conclusion: 'failure'
}

describe('durationChart', () => {
  const option = durationChart([{outcome: 'failure', points: [point]}], theme)

  it('draws one series per outcome in its colour, in minutes', () => {
    expect(option.series).toEqual([
      expect.objectContaining({
        name: 'Failed',
        type: 'scatter',
        itemStyle: {color: 'red'}
      })
    ])
    expect(option.series[0]?.data[0]?.value).toEqual([
      '2026-10-05T10:00:00Z',
      125_000 / 60_000
    ])
  })

  it('can be zoomed along time with the wheel and a slider', () => {
    expect(option.dataZoom.map(z => z.type)).toEqual(['inside', 'slider'])
  })

  it('keeps the run id on each point for drill-down', () => {
    expect(option.series[0]?.data[0]?.runId).toBe(7)
  })
})

describe('dailyChart', () => {
  const day: DayStats = {
    date: '2026-10-05',
    stats: {
      runs: 4,
      success: 3,
      failure: 1,
      successRate: 0.75,
      durationP50Ms: null,
      durationP95Ms: null,
      queueP50Ms: null
    }
  }

  it('shows run count and success rate as a percentage', () => {
    const option = dailyChart([day], theme)
    expect(option.series.map(s => [s.name, s.data[0]])).toEqual([
      ['Runs', ['2026-10-05', 4]],
      ['Success rate', ['2026-10-05', 75]]
    ])
  })
})

describe('dailyTooltipRows', () => {
  it('labels the date, run count and success rate', () => {
    expect(
      dailyTooltipRows([
        ['2026-10-05', 4],
        ['2026-10-05', 75]
      ])
    ).toEqual([
      {label: 'Date', value: '2026-10-05'},
      {label: 'Runs', value: '4'},
      {label: 'Success rate', value: '75%'}
    ])
  })

  it('shows a dash for a day with no success rate', () => {
    expect(
      dailyTooltipRows([
        ['2026-10-05', 2],
        ['2026-10-05', null]
      ])
    ).toContainEqual({
      label: 'Success rate',
      value: '—'
    })
  })

  it('returns nothing for data it does not recognise', () => {
    expect(dailyTooltipRows('nope')).toBeNull()
  })
})

describe('tooltipRows', () => {
  it('passes branch names through as plain values for text rendering', () => {
    expect(tooltipRows(point)).toContainEqual({
      label: 'Branch',
      value: point.branch
    })
  })

  it('formats the duration', () => {
    expect(tooltipRows(point)).toContainEqual({
      label: 'Duration',
      value: '2m 05s'
    })
  })
})
