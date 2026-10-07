import {describe, expect, it} from 'vitest'
import {formatDuration, formatPercent, runUrl} from './format'

describe('formatDuration', () => {
  it('shows a dash for no value', () => {
    expect(formatDuration(null)).toBe('—')
  })

  it('shows milliseconds below a second, and tenths below ten seconds', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(250.4)).toBe('250ms')
    expect(formatDuration(1_450)).toBe('1.5s')
  })

  it('picks units by size', () => {
    expect(formatDuration(14_400)).toBe('14s')
    expect(formatDuration(185_000)).toBe('3m 05s')
    expect(formatDuration(3_720_000)).toBe('1h 02m')
  })
})

describe('formatPercent', () => {
  it('rounds to a whole percent, or a dash', () => {
    expect(formatPercent(0.926)).toBe('93%')
    expect(formatPercent(null)).toBe('—')
  })
})

describe('runUrl', () => {
  it('builds a run link from the repository and id', () => {
    expect(runUrl('octo-org/octo-repo', 42)).toBe(
      'https://github.com/octo-org/octo-repo/actions/runs/42'
    )
  })

  it('refuses a repository that is not owner/name', () => {
    expect(runUrl('evil.com/x/../y', 42)).toBeNull()
    expect(runUrl('javascript:alert(1)//x', 42)).toBeNull()
  })
})
