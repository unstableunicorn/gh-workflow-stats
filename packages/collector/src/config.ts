// The Action's inputs, validated. Anything missing or odd stops the run.

export interface Config {
  token: string
  owner: string
  repo: string
  dataBranch: string
  backfillDays: number
  maxRequests: number
  recentDays: number
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** Reads and validates inputs; `defaultBranch` may never be the data branch. */
export function readConfig(
  input: (name: string) => string,
  env: Record<string, string | undefined>,
  defaultBranch: string
): Config {
  const required = (name: string): string => {
    const value = input(name).trim()
    if (value === '') throw new Error(`Input ${name} is required`)
    return value
  }
  const count = (name: string): number => {
    const value = Number(required(name))
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`Input ${name} must be a positive whole number`)
    return value
  }

  const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/')
  if (!owner || !repo)
    throw new Error('GITHUB_REPOSITORY is not set to owner/repo')

  const dataBranch = required('data-branch')
  if (!BRANCH.test(dataBranch) || dataBranch.includes('..'))
    throw new Error(
      `Input data-branch is not a plain branch name: ${JSON.stringify(dataBranch)}`
    )
  if (dataBranch === defaultBranch)
    throw new Error(
      `Input data-branch must not be the default branch (${defaultBranch})`
    )

  return {
    token: required('token'),
    owner,
    repo,
    dataBranch,
    backfillDays: count('backfill-days'),
    maxRequests: count('max-requests'),
    recentDays: count('recent-days')
  }
}
