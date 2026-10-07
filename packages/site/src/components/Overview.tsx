// The first view: every workflow's headline numbers from summary.json.

import type {Summary} from '@gh-workflow-stats/core'
import {formatDuration, formatPercent} from '../lib/format'
import {formatRoute} from '../lib/route'

export function Overview({summary}: {summary: Summary}) {
  if (summary.workflows.length === 0)
    return <p>No completed workflow runs have been collected yet.</p>

  return (
    <div class="table-scroll">
      <table>
        <caption>Workflows over the last {summary.recentDays} days</caption>
        <thead>
          <tr>
            <th scope="col">Workflow</th>
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
          {summary.workflows.map(w => (
            <tr key={w.id}>
              <th scope="row">
                <a href={formatRoute({view: 'workflow', id: w.id, days: 30})}>
                  {w.name}
                </a>
                <div class="muted">
                  <code>{w.path}</code>
                </div>
              </th>
              <td class="num">{w.recent.runs}</td>
              <td class="num">{formatPercent(w.recent.successRate)}</td>
              <td class="num">{formatDuration(w.recent.durationP50Ms)}</td>
              <td class="num">{formatDuration(w.recent.durationP95Ms)}</td>
              <td class="num">{formatDuration(w.recent.queueP50Ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
