// RunsApi and DataStore over Octokit's request function. Writes use the Git
// Data API, so the collector never checks out or pushes with git.

import type {ApiJob, ApiRun, DataStore, FileWrite, RunsApi} from './github'
import {RateLimitError} from './sync'

/** Octokit's `request`, narrowed to what the adapters use. */
export type Request = (
  route: string,
  params?: Record<string, unknown>
) => Promise<{data: unknown}>

export interface Repo {
  owner: string
  repo: string
}

interface HttpError {
  status?: number
  message?: string
  response?: {headers?: Record<string, string | undefined>}
}

function statusOf(error: unknown): number | undefined {
  return (error as HttpError | null)?.status
}

/** Rethrows `error` as a RateLimitError, or as a message naming `permission`. */
function explain(error: unknown, permission: string): never {
  const e = error as HttpError
  const remaining = e.response?.headers?.['x-ratelimit-remaining']
  if (
    e.status === 429 ||
    (e.status === 403 &&
      (remaining === '0' || /rate limit/i.test(e.message ?? '')))
  )
    throw new RateLimitError(e.message ?? 'rate limited')
  if (e.status === 403 || e.status === 401)
    throw new Error(
      `GitHub refused the request (${e.status}): the token needs ${permission}. ${e.message ?? ''}`
    )
  throw error
}

/** Reads runs and jobs with `request`; needs `actions: read`. */
export function octokitRunsApi(request: Request, repo: Repo): RunsApi {
  const call = async <T>(
    route: string,
    params: Record<string, unknown>
  ): Promise<T> => {
    try {
      return (await request(route, {...repo, ...params})).data as T
    } catch (error) {
      return explain(error, 'actions: read')
    }
  }
  return {
    async listRuns(created, page) {
      const data = await call<{total_count: number; workflow_runs: ApiRun[]}>(
        'GET /repos/{owner}/{repo}/actions/runs',
        {created, page, per_page: 100}
      )
      return {totalCount: data.total_count, runs: data.workflow_runs}
    },
    async listJobs(runId, attempt) {
      const jobs: ApiJob[] = []
      for (let page = 1; ; page++) {
        const data = await call<{jobs: ApiJob[]}>(
          'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs',
          {run_id: runId, attempt_number: attempt, page, per_page: 100}
        )
        jobs.push(...data.jobs)
        if (data.jobs.length < 100) return jobs
      }
    }
  }
}

/** Reads and writes `branch` with `request`; needs `contents: write`. */
export function octokitDataStore(
  request: Request,
  repo: Repo,
  branch: string
): DataStore {
  const call = async <T>(
    route: string,
    params: Record<string, unknown>
  ): Promise<T> => {
    try {
      return (await request(route, {...repo, ...params})).data as T
    } catch (error) {
      return explain(error, 'contents: write')
    }
  }
  const orNull = async <T>(read: Promise<T>): Promise<T | null> => {
    try {
      return await read
    } catch (error) {
      if (statusOf(error) === 404) return null
      throw error
    }
  }
  return {
    async head() {
      const ref = await orNull(
        call<{object: {sha: string}}>(
          'GET /repos/{owner}/{repo}/git/ref/{ref}',
          {ref: `heads/${branch}`}
        )
      )
      return ref?.object.sha ?? null
    },
    async read(sha, path) {
      return orNull(
        call<string>('GET /repos/{owner}/{repo}/contents/{path}', {
          path,
          ref: sha,
          headers: {accept: 'application/vnd.github.raw+json'}
        })
      )
    },
    async commit(parent, files: FileWrite[], message) {
      const base =
        parent === null
          ? {}
          : {
              base_tree: (
                await call<{tree: {sha: string}}>(
                  'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
                  {
                    commit_sha: parent
                  }
                )
              ).tree.sha
            }
      const tree = await call<{sha: string}>(
        'POST /repos/{owner}/{repo}/git/trees',
        {
          ...base,
          tree: files.map(f => ({
            path: f.path,
            mode: '100644',
            type: 'blob',
            content: f.content
          }))
        }
      )
      const commit = await call<{sha: string}>(
        'POST /repos/{owner}/{repo}/git/commits',
        {
          message,
          tree: tree.sha,
          parents: parent === null ? [] : [parent]
        }
      )
      if (parent === null)
        await call('POST /repos/{owner}/{repo}/git/refs', {
          ref: `refs/heads/${branch}`,
          sha: commit.sha
        })
      else
        await call('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
          ref: `heads/${branch}`,
          sha: commit.sha,
          force: false
        })
      return commit.sha
    }
  }
}
