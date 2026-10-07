// An ECharts chart: renders an option, follows resizes, links zoom with its
// group, and builds tooltips as DOM text.

import {useEffect, useRef} from 'preact/hooks'
import * as echarts from 'echarts/core'
import {BarChart, LineChart, ScatterChart} from 'echarts/charts'
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent
} from 'echarts/components'
import {CanvasRenderer} from 'echarts/renderers'
import './chart.css'

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer
])

export interface Row {
  label: string
  value: string
}

interface Props {
  /** An ECharts option; see lib/charts.ts. */
  option: echarts.EChartsCoreOption
  /** Accessible name; the data is also in a table beside the chart. */
  label: string
  /** Charts sharing a group zoom together. */
  group?: string
  /** Tooltip rows for the hovered data (an array on an axis tooltip), set as text. */
  rows?: (data: unknown) => Row[] | null
  onItemClick?: (data: unknown) => void
}

function tooltipElement(rows: Row[]): HTMLElement {
  const list = document.createElement('dl')
  list.className = 'chart-tooltip'
  for (const row of rows) {
    const term = document.createElement('dt')
    term.textContent = row.label
    const value = document.createElement('dd')
    value.textContent = row.value
    list.append(term, value)
  }
  return list
}

export function Chart({option, label, group, rows, onItemClick}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const chart = echarts.init(el, null, {renderer: 'canvas'})
    const withTooltip = rows
      ? {
          ...option,
          tooltip: {
            ...(option.tooltip as object | undefined),
            formatter: (params: {data: unknown} | {data: unknown}[]) => {
              const r = rows(
                Array.isArray(params) ? params.map(p => p.data) : params.data
              )
              return r === null ? '' : tooltipElement(r)
            }
          }
        }
      : option
    chart.setOption(withTooltip)
    if (group !== undefined) {
      chart.group = group
      echarts.connect(group)
    }
    if (onItemClick) chart.on('click', params => onItemClick(params.data))
    const resize = new ResizeObserver(() => chart.resize())
    resize.observe(el)
    return () => {
      resize.disconnect()
      chart.dispose()
    }
  }, [option, group, rows, onItemClick])

  return <div ref={ref} class="chart" role="img" aria-label={label} />
}
