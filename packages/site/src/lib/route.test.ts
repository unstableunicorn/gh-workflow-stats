import {describe, expect, it} from 'vitest'
import {formatRoute, parseRoute} from './route'

describe('parseRoute', () => {
  it('reads the overview from an empty hash', () => {
    expect(parseRoute('')).toEqual({view: 'overview'})
    expect(parseRoute('#/')).toEqual({view: 'overview'})
  })

  it('reads a workflow with its filters', () => {
    expect(parseRoute('#/workflow/123?branch=feature%2Fx&days=7')).toEqual({
      view: 'workflow',
      id: 123,
      branch: 'feature/x',
      days: 7
    })
  })

  it('defaults to 30 days and all branches', () => {
    expect(parseRoute('#/workflow/5')).toEqual({
      view: 'workflow',
      id: 5,
      days: 30
    })
  })

  it('accepts all history', () => {
    expect(parseRoute('#/workflow/5?days=all')).toMatchObject({days: 'all'})
  })

  it('falls back to 30 days for an unexpected value', () => {
    expect(parseRoute('#/workflow/5?days=13')).toMatchObject({days: 30})
  })

  it('treats an unknown path as not found', () => {
    expect(parseRoute('#/nope')).toEqual({view: 'not-found'})
    expect(parseRoute('#/workflow/abc')).toEqual({view: 'not-found'})
  })
})

describe('test routes', () => {
  it('reads the tests view with its filters', () => {
    expect(parseRoute('#/tests?suite=unit&days=7')).toEqual({
      view: 'tests',
      suite: 'unit',
      days: 7
    })
  })

  it('reads one test by its key', () => {
    expect(parseRoute('#/test?key=unit%3A%3Apkg%3A%3Aa%20b')).toEqual({
      view: 'test',
      key: 'unit::pkg::a b',
      days: 30
    })
  })

  it('treats a test view without a key as not found', () => {
    expect(parseRoute('#/test')).toEqual({view: 'not-found'})
  })

  it('round-trips test routes', () => {
    const tests = {view: 'tests', suite: 'e2e', days: 90} as const
    const test = {view: 'test', key: 'unit::a&b=c?#', days: 'all'} as const
    expect(parseRoute(formatRoute(tests))).toEqual(tests)
    expect(parseRoute(formatRoute(test))).toEqual(test)
  })
})

describe('formatRoute', () => {
  it('round-trips a workflow route', () => {
    const route = {view: 'workflow', id: 9, branch: 'a b&c', days: 90} as const
    expect(parseRoute(formatRoute(route))).toEqual(route)
  })

  it('leaves default filters out of the URL', () => {
    expect(formatRoute({view: 'workflow', id: 9, days: 30})).toBe(
      '#/workflow/9'
    )
  })
})
