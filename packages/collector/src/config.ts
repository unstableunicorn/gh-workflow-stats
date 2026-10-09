// The Action's inputs, validated. Anything missing or odd stops the run.

export interface Config {
  /** Reads runs, jobs and artifacts of `owner/repo`. */
  token: string
  owner: string
  repo: string
  /** Writes the data branch of `dataOwner/dataRepo`. */
  dataToken: string
  dataOwner: string
  dataRepo: string
  dataBranch: string
  backfillDays: number
  maxRequests: number
  recentDays: number
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const REPOSITORY = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/

/** Reads and validates inputs; the data repository defaults to this one. */
export function readConfig(
  input: (name: string) => string,
  env: Record<string, string | undefined>
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

  const dataRepository = input('data-repository').trim() || `${owner}/${repo}`
  const match = REPOSITORY.exec(dataRepository)
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    dataRepository.includes('..')
  )
    throw new Error(
      `Input data-repository is not owner/name: ${JSON.stringify(dataRepository)}`
    )

  const token = required('token')
  return {
    token,
    owner,
    repo,
    dataToken: input('data-token').trim() || token,
    dataOwner: match[1],
    dataRepo: match[2],
    dataBranch,
    backfillDays: count('backfill-days'),
    maxRequests: count('max-requests'),
    recentDays: count('recent-days')
  }
}

/** Throws if the data branch is the data repository's default branch. */
export function assertNotDefaultBranch(
  config: Config,
  defaultBranch: string
): void {
  if (config.dataBranch === defaultBranch)
    throw new Error(
      `Input data-branch must not be the default branch (${defaultBranch}) of ${config.dataOwner}/${config.dataRepo}`
    )
}
