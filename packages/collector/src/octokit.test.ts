import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {RateLimitError} from './sync'
import {
  octokitArtifactsApi,
  octokitDataStore,
  octokitRunsApi,
  type Request
} from './octokit'

const repo = {owner: 'octo-org', repo: 'octo-repo'}

function httpError(
  status: number,
  headers: Record<string, string> = {},
  message = 'error'
): Error {
  return Object.assign(new Error(message), {status, response: {headers}})
}

/** A fake request function answering by route, recording every call. */
function fakeRequest(
  answers: Record<string, (params: Record<string, unknown>) => unknown>
) {
  const calls: {route: string; params: Record<string, unknown>}[] = []
  const request: Request = async (route, params = {}) => {
    calls.push({route, params})
    const answer = answers[route]
    if (!answer) throw new Error(`unexpected route ${route}`)
    return {data: await answer(params)}
  }
  return {request, calls}
}

describe('octokitRunsApi', () => {
  it('lists one page of runs in a created range', async () => {
    const {request, calls} = fakeRequest({
      'GET /repos/{owner}/{repo}/actions/runs': () => ({
        total_count: 1,
        workflow_runs: [{id: 7}]
      })
    })
    const result = await octokitRunsApi(request, repo).listRuns('a..b', 2)
    expect(result).toEqual({totalCount: 1, runs: [{id: 7}]})
    expect(calls[0]?.params).toMatchObject({
      created: 'a..b',
      page: 2,
      per_page: 100
    })
  })

  it('pages through every job of an attempt', async () => {
    const {request} = fakeRequest({
      'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs':
        p => ({
          jobs: Array.from({length: p.page === 1 ? 100 : 3}, (_, i) => ({
            id: i
          }))
        })
    })
    expect(await octokitRunsApi(request, repo).listJobs(1, 1)).toHaveLength(103)
  })

  it('turns a 429 into a RateLimitError', async () => {
    const request: Request = async () => {
      throw httpError(429)
    }
    await expect(
      octokitRunsApi(request, repo).listRuns('a..b', 1)
    ).rejects.toBeInstanceOf(RateLimitError)
  })

  it('turns a 403 with no requests remaining into a RateLimitError', async () => {
    const request: Request = async () => {
      throw httpError(403, {'x-ratelimit-remaining': '0'})
    }
    await expect(
      octokitRunsApi(request, repo).listJobs(1, 1)
    ).rejects.toBeInstanceOf(RateLimitError)
  })

  it('names the missing permission on any other 403', async () => {
    const request: Request = async () => {
      throw httpError(
        403,
        {'x-ratelimit-remaining': '900'},
        'Resource not accessible by integration'
      )
    }
    await expect(
      octokitRunsApi(request, repo).listRuns('a..b', 1)
    ).rejects.toThrow(/actions: read/)
  })
})

describe('octokitDataStore', () => {
  it('reports a missing branch as no head', async () => {
    const request: Request = async () => {
      throw httpError(404)
    }
    expect(await octokitDataStore(request, repo, 'data').head()).toBeNull()
  })

  it('reads a file raw at a commit, and a missing one as null', async () => {
    const {request, calls} = fakeRequest({
      'GET /repos/{owner}/{repo}/contents/{path}': p => {
        if (p.path === 'missing.json') throw httpError(404)
        return '{"a":1}'
      }
    })
    const store = octokitDataStore(request, repo, 'data')
    expect(await store.read('abc', 'state.json')).toBe('{"a":1}')
    expect(await store.read('abc', 'missing.json')).toBeNull()
    expect(calls[0]?.params).toMatchObject({
      ref: 'abc',
      headers: {accept: 'application/vnd.github.raw+json'}
    })
  })

  it('creates the branch for a first commit', async () => {
    const {request, calls} = fakeRequest({
      'POST /repos/{owner}/{repo}/git/trees': () => ({sha: 'tree1'}),
      'POST /repos/{owner}/{repo}/git/commits': () => ({sha: 'commit1'}),
      'POST /repos/{owner}/{repo}/git/refs': () => ({})
    })
    await octokitDataStore(request, repo, 'data').commit(
      null,
      [{path: 'a.json', content: '{}'}],
      'm'
    )
    expect(calls[0]?.params).not.toHaveProperty('base_tree')
    expect(calls[1]?.params).toMatchObject({parents: [], tree: 'tree1'})
    expect(calls[2]?.params).toMatchObject({
      ref: 'refs/heads/data',
      sha: 'commit1'
    })
  })

  it('fast-forwards an existing branch and never forces', async () => {
    const {request, calls} = fakeRequest({
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}': () => ({
        tree: {sha: 'base'}
      }),
      'POST /repos/{owner}/{repo}/git/trees': () => ({sha: 'tree2'}),
      'POST /repos/{owner}/{repo}/git/commits': () => ({sha: 'commit2'}),
      'PATCH /repos/{owner}/{repo}/git/refs/{ref}': () => ({})
    })
    await octokitDataStore(request, repo, 'data').commit(
      'commit1',
      [{path: 'a.json', content: '{}'}],
      'm'
    )
    expect(calls[1]?.params).toMatchObject({base_tree: 'base'})
    expect(calls[2]?.params).toMatchObject({parents: ['commit1']})
    expect(calls[3]?.params).toMatchObject({
      ref: 'heads/data',
      sha: 'commit2',
      force: false
    })
  })

  it('names the missing permission when a write is refused', async () => {
    const request: Request = async () => {
      throw httpError(403, {'x-ratelimit-remaining': '900'})
    }
    await expect(
      octokitDataStore(request, repo, 'data').commit(
        null,
        [{path: 'a', content: ''}],
        'm'
      )
    ).rejects.toThrow(/contents: write/)
  })
})

describe('octokitArtifactsApi', () => {
  const noDownload = async () => {
    throw new Error('not used')
  }

  it('pages through a run’s artifacts', async () => {
    const {request, calls} = fakeRequest({
      'GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts': p => ({
        artifacts: Array.from({length: p.page === 1 ? 100 : 1}, (_, i) => ({
          id: i,
          name: `a${i}`,
          expired: false,
          size_in_bytes: 1
        }))
      })
    })
    const list = await octokitArtifactsApi(request, repo, noDownload).listArtifacts(9)
    expect(list).toHaveLength(101)
    expect(calls[0]?.params).toMatchObject({run_id: 9, per_page: 100, page: 1})
  })

  it('reads the single file the download writes', async () => {
    const api = octokitArtifactsApi(fakeRequest({}).request, repo, async (id, runId, dir) => {
      await writeFile(join(dir, `report-${id}-${runId}.json`), '{"ok":1}')
    })
    expect(await api.downloadText(3, 9)).toBe('{"ok":1}')
  })

  it('refuses a download that is not exactly one file', async () => {
    const api = octokitArtifactsApi(fakeRequest({}).request, repo, async (_id, _run, dir) => {
      await writeFile(join(dir, 'a.json'), '{}')
      await writeFile(join(dir, 'b.json'), '{}')
    })
    await expect(api.downloadText(3, 9)).rejects.toThrow(/2 files/)
  })

  it('names the missing permission when listing is refused', async () => {
    const request: Request = async () => {
      throw httpError(403, {'x-ratelimit-remaining': '900'})
    }
    await expect(octokitArtifactsApi(request, repo, noDownload).listArtifacts(9)).rejects.toThrow(
      /actions: read/
    )
  })
})
