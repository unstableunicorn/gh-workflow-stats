// How current the data is, and whether the collector is still catching up.

import type {Summary} from '@gh-workflow-stats/core'

/** A caught-up collector leaves its cursor about a day behind; allow slack. */
const CAUGHT_UP_LAG_MS = 26 * 3_600_000

export interface Freshness {
  updated: string
  catchingUp: boolean
  completeThrough?: string
}

function utc(iso: string): string {
  return `${iso.replace('T', ' ').slice(0, 16)} UTC`
}

/** When the data was last written and how far back it is complete. */
export function freshness(
  summary: Pick<Summary, 'generatedAt' | 'syncedThrough'>
): Freshness {
  const updated = utc(new Date(Date.parse(summary.generatedAt)).toISOString())
  if (summary.syncedThrough === null) return {updated, catchingUp: true}
  const lag =
    Date.parse(summary.generatedAt) - Date.parse(summary.syncedThrough)
  if (lag <= CAUGHT_UP_LAG_MS) return {updated, catchingUp: false}
  return {
    updated,
    catchingUp: true,
    completeThrough: utc(
      new Date(Date.parse(summary.syncedThrough)).toISOString()
    )
  }
}
