import {describe, expect, it} from 'vitest'
import {
  loadRuns,
  loadSummary,
  loadTestShards,
  monthsToLoad,
  rangeFor
} from './data'

const NOW = new Date('2026-10-07T12:00:00Z')

function fakeFetch(files: Record<string, unknown>) {
  const asked: string[] = []
  const fetchJson = async (path: string): Promise<unknown> => {
    asked.push(path)
    if (!(path in files)) throw new Error(`404 ${path}`)
    return files[path]
  }
  return {fetchJson, asked}
}

describe('rangeFor', () => {
  it('starts `days` before now', () => {
    expect(rangeFor(7, NOW)).toEqual({from: '2026-09-30T12:00:00.000Z'})
  })

  it('has no lower bound for all history', () => {
    expect(rangeFor('all', NOW)).toEqual({})
  })
})

describe('monthsToLoad', () => {
  const available = ['2026-07', '2026-08', '2026-09', '2026-10']

  it('loads only the months the range touches', () => {
    expect(monthsToLoad({from: '2026-09-30T12:00:00Z'}, available)).toEqual([
      '2026-09',
      '2026-10'
    ])
  })

  it('loads every month for all history', () => {
    expect(monthsToLoad({}, available)).toEqual(available)
  })
})

describe('loadSummary', () => {
  it('returns a summary it can read', async () => {
    const {fetchJson} = fakeFetch({
      'data/summary.json': {schemaVersion: 1, months: []}
    })
    expect(await loadSummary(fetchJson)).toMatchObject({months: []})
  })

  it('explains a summary from another schema version', async () => {
    const {fetchJson} = fakeFetch({'data/summary.json': {schemaVersion: 2}})
    await expect(loadSummary(fetchJson)).rejects.toThrow(/version 2/)
  })

  it('explains missing data', async () => {
    const {fetchJson} = fakeFetch({})
    await expect(loadSummary(fetchJson)).rejects.toThrow(/No data yet/)
  })
})

describe('loadRuns', () => {
  it('fetches each month and joins their runs in order', async () => {
    const {fetchJson, asked} = fakeFetch({
      'data/runs/2026-09.json': {schemaVersion: 1, runs: [{id: 1}]},
      'data/runs/2026-10.json': {schemaVersion: 1, runs: [{id: 2}]}
    })
    const runs = await loadRuns(fetchJson, ['2026-09', '2026-10'])
    expect(runs.map(r => r.id)).toEqual([1, 2])
    expect(asked).toEqual(['data/runs/2026-09.json', 'data/runs/2026-10.json'])
  })
})

describe('loadTestShards', () => {
  it('fetches each month of test results', async () => {
    const {fetchJson, asked} = fakeFetch({
      'data/tests/2026-10.json': {schemaVersion: 1, month: '2026-10', runs: []}
    })
    const shards = await loadTestShards(fetchJson, ['2026-10'])
    expect(shards.map(s => s.month)).toEqual(['2026-10'])
    expect(asked).toEqual(['data/tests/2026-10.json'])
  })

  it('explains a shard from another schema version', async () => {
    const {fetchJson} = fakeFetch({
      'data/tests/2026-10.json': {schemaVersion: 9}
    })
    await expect(loadTestShards(fetchJson, ['2026-10'])).rejects.toThrow(
      /version 9/
    )
  })
})
