// The shell: loads summary.json, follows the hash route, shows data freshness.

import {useEffect, useState} from 'preact/hooks'
import type {Summary} from '@gh-workflow-stats/core'
import {Overview} from './Overview'
import {WorkflowPage} from './WorkflowPage'
import {loadSummary, type FetchJson} from '../lib/data'
import {freshness} from '../lib/freshness'
import {parseRoute, type Route} from '../lib/route'
import './app.css'

interface Props {
  fetchJson: FetchJson
  now: Date
}

export function App({fetchJson, now}: Props) {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash))
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    loadSummary(fetchJson)
      .then(setSummary)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e))
      )
  }, [fetchJson])

  const fresh = summary === null ? null : freshness(summary)

  return (
    <>
      <header class="site-header">
        <h1>
          <a href="#/">Workflow stats</a>
        </h1>
        {summary !== null && <p class="muted">{summary.repository}</p>}
      </header>
      <main>
        {error !== null && <p class="notice">{error}</p>}
        {summary === null && error === null && (
          <p aria-live="polite">Loading…</p>
        )}
        {fresh !== null && (
          <p class="muted">
            Data updated {fresh.updated}.
            {fresh.catchingUp && (
              <span class="notice">
                {' '}
                Collection is still catching up
                {fresh.completeThrough === undefined
                  ? '.'
                  : `: runs before ${fresh.completeThrough} are complete.`}
              </span>
            )}
          </p>
        )}
        {summary !== null && route.view === 'overview' && (
          <Overview summary={summary} />
        )}
        {summary !== null && route.view === 'workflow' && (
          <WorkflowPage
            route={route}
            summary={summary}
            fetchJson={fetchJson}
            now={now}
          />
        )}
        {route.view === 'not-found' && (
          <p>
            Page not found. <a href="#/">Back to all workflows</a>
          </p>
        )}
      </main>
    </>
  )
}
