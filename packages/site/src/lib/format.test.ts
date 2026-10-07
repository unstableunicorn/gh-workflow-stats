import {describe, expect, it} from 'vitest'
import {formatDuration, formatPercent, runUrl} from './format'

describe('formatDuration', () => {
  it('shows a dash for no value', () => {
    expect(formatDuration(null)).toBe('—')
  })

  it('picks units by size', () => {
    expect(formatDuration(4_400)).toBe('4s')
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
