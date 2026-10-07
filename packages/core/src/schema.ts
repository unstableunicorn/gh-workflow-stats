// The JSON written to the data branch: the contract between collector and site.
// Bump SCHEMA_VERSION on any change a reader of older data would misread.

export const SCHEMA_VERSION = 1

/** A job of a workflow run, as stored. Times are ISO 8601 strings. */
export interface JobRecord {
  id: number
  name: string
  conclusion: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

/** A completed workflow run (its latest attempt) with its jobs. */
export interface RunRecord {
  id: number
  attempt: number
  workflowId: number
  workflowName: string
  workflowPath: string
  event: string
  branch: string | null
  headSha: string
  conclusion: string | null
  createdAt: string
  startedAt: string
  updatedAt: string
  jobs: JobRecord[]
}

/** One month of runs: `runs/YYYY-MM.json`, sorted by createdAt. */
export interface RunShard {
  schemaVersion: typeof SCHEMA_VERSION
  month: string
  runs: RunRecord[]
}

/** The collector's resume point: `state.json`. */
export interface SyncState {
  schemaVersion: typeof SCHEMA_VERSION
  /** Runs created at or after this time may still be missing or incomplete. */
  cursor: string | null
}

/** Headline numbers over a set of runs. Durations are milliseconds. */
export interface RunStats {
  runs: number
  success: number
  failure: number
  successRate: number | null
  durationP50Ms: number | null
  durationP95Ms: number | null
  queueP50Ms: number | null
}

export interface WorkflowSummary {
  id: number
  name: string
  path: string
  recent: RunStats
}

/** The index the site loads first: `summary.json`. */
export interface Summary {
  schemaVersion: typeof SCHEMA_VERSION
  repository: string
  generatedAt: string
  /** Data is complete for runs created before this time. */
  syncedThrough: string | null
  recentDays: number
  months: string[]
  workflows: WorkflowSummary[]
}

export const paths = {
  state: 'state.json',
  summary: 'summary.json',
  shard: (month: string): string => `runs/${month}.json`
}
