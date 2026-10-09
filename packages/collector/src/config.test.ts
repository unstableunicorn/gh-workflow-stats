import {describe, expect, it} from 'vitest'
import {assertNotDefaultBranch, readConfig} from './config'

const env = {GITHUB_REPOSITORY: 'octo-org/octo-repo'}
const inputs = (values: Record<string, string>) => (name: string) =>
  values[name] ?? ''
const valid = {
  token: 't',
  'data-branch': 'gh-workflow-stats-data',
  'backfill-days': '90',
  'max-requests': '300',
  'recent-days': '30'
}

describe('readConfig', () => {
  it('reads every input', () => {
    expect(readConfig(inputs(valid), env)).toMatchObject({
      owner: 'octo-org',
      repo: 'octo-repo',
      dataBranch: 'gh-workflow-stats-data',
      backfillDays: 90,
      maxRequests: 300,
      recentDays: 30
    })
  })

  it.each(['token', 'data-branch', 'backfill-days'])(
    'refuses an empty %s',
    name => {
      expect(() => readConfig(inputs({...valid, [name]: ''}), env)).toThrow(
        name
      )
    }
  )

  it('refuses a number that is not a positive integer', () => {
    expect(() =>
      readConfig(inputs({...valid, 'max-requests': '-1'}), env)
    ).toThrow(/max-requests/)
  })

  it('refuses to write to the data repository’s default branch', () => {
    const config = readConfig(inputs({...valid, 'data-branch': 'main'}), env)
    expect(() => assertNotDefaultBranch(config, 'main')).toThrow(
      /default branch/
    )
    expect(() => assertNotDefaultBranch(config, 'trunk')).not.toThrow()
  })

  it('refuses a branch name with unexpected characters', () => {
    expect(() =>
      readConfig(inputs({...valid, 'data-branch': 'a b;c'}), env)
    ).toThrow(/data-branch/)
  })

  it('writes to the same repository with the same token by default', () => {
    expect(readConfig(inputs(valid), env)).toMatchObject({
      dataOwner: 'octo-org',
      dataRepo: 'octo-repo',
      dataToken: 't'
    })
  })

  it('reads a separate data repository and its token', () => {
    const config = readConfig(
      inputs({
        ...valid,
        'data-repository': 'octo-org/octo-stats',
        'data-token': 'd'
      }),
      env
    )
    expect(config).toMatchObject({
      owner: 'octo-org',
      repo: 'octo-repo',
      token: 't',
      dataOwner: 'octo-org',
      dataRepo: 'octo-stats',
      dataToken: 'd'
    })
  })

  it('refuses a data repository that is not owner/name', () => {
    expect(() =>
      readConfig(inputs({...valid, 'data-repository': 'octo-org/../x'}), env)
    ).toThrow(/data-repository/)
  })

  it('refuses a missing GITHUB_REPOSITORY', () => {
    expect(() => readConfig(inputs(valid), {})).toThrow(/GITHUB_REPOSITORY/)
  })
})
