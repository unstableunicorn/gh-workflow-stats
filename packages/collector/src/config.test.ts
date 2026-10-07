import {describe, expect, it} from 'vitest'
import {readConfig} from './config'

const env = {GITHUB_REPOSITORY: 'octo-org/octo-repo'}
const inputs = (values: Record<string, string>) => (name: string) => values[name] ?? ''
const valid = {
  token: 't',
  'data-branch': 'gh-workflow-stats-data',
  'backfill-days': '90',
  'max-requests': '300',
  'recent-days': '30'
}

describe('readConfig', () => {
  it('reads every input', () => {
    expect(readConfig(inputs(valid), env, 'main')).toMatchObject({
      owner: 'octo-org',
      repo: 'octo-repo',
      dataBranch: 'gh-workflow-stats-data',
      backfillDays: 90,
      maxRequests: 300,
      recentDays: 30
    })
  })

  it.each(['token', 'data-branch', 'backfill-days'])('refuses an empty %s', name => {
    expect(() => readConfig(inputs({...valid, [name]: ''}), env, 'main')).toThrow(name)
  })

  it('refuses a number that is not a positive integer', () => {
    expect(() => readConfig(inputs({...valid, 'max-requests': '-1'}), env, 'main')).toThrow(
      /max-requests/
    )
  })

  it('refuses to write to the default branch', () => {
    expect(() => readConfig(inputs({...valid, 'data-branch': 'main'}), env, 'main')).toThrow(
      /default branch/
    )
  })

  it('refuses a branch name with unexpected characters', () => {
    expect(() => readConfig(inputs({...valid, 'data-branch': 'a b;c'}), env, 'main')).toThrow(
      /data-branch/
    )
  })

  it('refuses a missing GITHUB_REPOSITORY', () => {
    expect(() => readConfig(inputs(valid), {}, 'main')).toThrow(/GITHUB_REPOSITORY/)
  })
})
