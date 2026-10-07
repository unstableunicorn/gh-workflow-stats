import {describe, expect, it} from 'vitest'
import {freshness} from './freshness'

describe('freshness', () => {
  it('reports a caught-up collection as complete', () => {
    expect(
      freshness({
        generatedAt: '2026-10-07T12:00:00Z',
        syncedThrough: '2026-10-06T12:00:00Z'
      })
    ).toEqual({updated: '2026-10-07 12:00 UTC', catchingUp: false})
  })

  it('warns when the collection stopped short and is still catching up', () => {
    expect(
      freshness({
        generatedAt: '2026-10-07T12:00:00Z',
        syncedThrough: '2026-09-20T00:00:00Z'
      })
    ).toMatchObject({catchingUp: true, completeThrough: '2026-09-20 00:00 UTC'})
  })

  it('warns when nothing has been synced', () => {
    expect(
      freshness({generatedAt: '2026-10-07T12:00:00Z', syncedThrough: null})
    ).toMatchObject({
      catchingUp: true
    })
  })
})
