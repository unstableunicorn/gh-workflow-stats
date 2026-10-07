// Loading the JSON next to the site: the summary first, month shards on demand.

import {
  SCHEMA_VERSION,
  monthOf,
  paths,
  type RunRecord,
  type RunShard,
  type Summary
} from '@gh-workflow-stats/core'
import type {Days} from './route'

const DAY = 86_400_000
const DATA_DIR = 'data/'

/** Fetches and parses a JSON file at a path relative to the site. */
export type FetchJson = (path: string) => Promise<unknown>

export interface Range {
  from?: string
}

/** The range for the last `days` days before `now`; no bound for 'all'. */
export function rangeFor(days: Days, now: Date): Range {
  return days === 'all'
    ? {}
    : {from: new Date(now.getTime() - days * DAY).toISOString()}
}

/** The available months that `range` touches. */
export function monthsToLoad(range: Range, available: string[]): string[] {
  const first = range.from === undefined ? '' : monthOf(range.from)
  return available.filter(m => m >= first)
}

function checkVersion<T>(path: string, data: unknown): T {
  const version = (data as {schemaVersion?: unknown} | null)?.schemaVersion
  if (version !== SCHEMA_VERSION)
    throw new Error(
      `${path} has data version ${String(version)}, but this site reads version ${SCHEMA_VERSION}. Rebuild the site from a matching release.`
    )
  return data as T
}

/** Loads summary.json, explaining missing or mismatched data. */
export async function loadSummary(fetchJson: FetchJson): Promise<Summary> {
  const path = DATA_DIR + paths.summary
  let data: unknown
  try {
    data = await fetchJson(path)
  } catch (error) {
    throw new Error(`No data yet: could not load ${path} (${String(error)}).`, {
      cause: error
    })
  }
  return checkVersion<Summary>(path, data)
}

/** Loads the given month shards and joins their runs, oldest first. */
export async function loadRuns(
  fetchJson: FetchJson,
  months: string[]
): Promise<RunRecord[]> {
  const shards = await Promise.all(
    months.map(async m => {
      const path = DATA_DIR + paths.shard(m)
      return checkVersion<RunShard>(path, await fetchJson(path))
    })
  )
  return shards.flatMap(s => s.runs)
}
