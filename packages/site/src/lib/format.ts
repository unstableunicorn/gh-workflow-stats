// Display formatting, and links to GitHub built from ids, never taken as given.

const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

/** A duration as `4s`, `3m 05s` or `1h 02m`; a dash for null. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** A rate (0–1) as a whole percent; a dash for null. */
export function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** The run's page on github.com, or null if `repository` is not owner/name. */
export function runUrl(repository: string, runId: number): string | null {
  if (!REPOSITORY.test(repository) || repository.includes('..')) return null
  return `https://github.com/${repository}/actions/runs/${runId}`
}
