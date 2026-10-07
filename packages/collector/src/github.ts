// The narrow slices of the GitHub API the collector uses, and their mapping
// to stored records. Tests inject fakes of these interfaces.

import type {JobRecord, RunRecord} from '@gh-workflow-stats/core'

/** The fields of a workflow run the collector reads from the REST API. */
export interface ApiRun {
  id: number
  run_attempt?: number
  workflow_id: number
  name?: string | null
  path: string
  event: string
  head_branch: string | null
  head_sha: string
  status: string | null
  conclusion: string | null
  created_at: string
  run_started_at?: string
  updated_at: string
}

/** The fields of a workflow job the collector reads from the REST API. */
export interface ApiJob {
  id: number
  name: string
  conclusion: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

/** Reads workflow runs and jobs. */
export interface RunsApi {
  /** One page (100) of runs created in `created` (`from..to`), newest first. */
  listRuns(
    created: string,
    page: number
  ): Promise<{totalCount: number; runs: ApiRun[]}>
  /** Every job of one attempt of a run. */
  listJobs(runId: number, attempt: number): Promise<ApiJob[]>
}

export interface FileWrite {
  path: string
  content: string
}

/** Reads and writes files on the data branch, one commit at a time. */
export interface DataStore {
  /** The branch's head commit, or null if the branch does not exist. */
  head(): Promise<string | null>
  /** A file's content at commit `sha`, or null if it does not exist. */
  read(sha: string, path: string): Promise<string | null>
  /** Commits `files` on `parent` (null: a first, parentless commit). */
  commit(
    parent: string | null,
    files: FileWrite[],
    message: string
  ): Promise<string>
}

/** Maps an API job to its stored form. */
export function toJobRecord(job: ApiJob): JobRecord {
  return {
    id: job.id,
    name: job.name,
    conclusion: job.conclusion,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at
  }
}

/** Maps an API run and its jobs to its stored form. */
export function toRunRecord(run: ApiRun, jobs: ApiJob[]): RunRecord {
  return {
    id: run.id,
    attempt: run.run_attempt ?? 1,
    workflowId: run.workflow_id,
    workflowName: run.name ?? run.path,
    workflowPath: run.path,
    event: run.event,
    branch: run.head_branch,
    headSha: run.head_sha,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    startedAt: run.run_started_at ?? run.created_at,
    updatedAt: run.updated_at,
    jobs: jobs.map(toJobRecord)
  }
}
