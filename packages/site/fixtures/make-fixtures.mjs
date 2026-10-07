// Writes invented data-branch files for local preview and the build test.
// Usage: node fixtures/make-fixtures.mjs <out-dir>

import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import process from 'node:process'

const out = process.argv[2]
if (!out) throw new Error('Usage: make-fixtures.mjs <out-dir>')

const END = Date.parse('2026-10-07T12:00:00Z')
const DAY = 86_400_000
let seed = 42
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
const iso = ms => new Date(ms).toISOString()

const workflows = [
  {
    id: 1001,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    jobs: ['lint', 'test', 'build'],
    minutes: 4
  },
  {
    id: 1002,
    name: 'Release',
    path: '.github/workflows/release.yml',
    jobs: ['publish'],
    minutes: 2
  }
]
const branches = [
  'main',
  'main',
  'main',
  'feature/octo-1',
  'fix/<b>not-html</b>'
]

const runs = []
for (let i = 0; i < 400; i++) {
  const wf = workflows[random() < 0.85 ? 0 : 1]
  const created = END - random() * 60 * DAY
  const roll = random()
  const conclusion =
    roll < 0.82 ? 'success' : roll < 0.95 ? 'failure' : 'cancelled'
  let at = created + random() * 20_000
  const jobs = wf.jobs.map((name, j) => {
    const createdAt = at
    const startedAt = createdAt + random() * 30_000
    const completedAt =
      startedAt +
      ((0.5 + random()) * wf.minutes * 60_000 * (j + 1)) / wf.jobs.length
    at = completedAt
    return {
      id: i * 10 + j,
      name,
      conclusion,
      createdAt: iso(createdAt),
      startedAt: iso(startedAt),
      completedAt: iso(completedAt)
    }
  })
  runs.push({
    id: 5000 + i,
    attempt: 1,
    workflowId: wf.id,
    workflowName: wf.name,
    workflowPath: wf.path,
    event: 'push',
    branch: branches[Math.floor(random() * branches.length)],
    headSha: (i * 7919).toString(16).padStart(40, '0'),
    conclusion,
    createdAt: iso(created),
    startedAt: iso(created),
    updatedAt: iso(at),
    jobs
  })
}
runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

const byMonth = Map.groupBy(runs, r => r.createdAt.slice(0, 7))
mkdirSync(join(out, 'runs'), {recursive: true})
for (const [month, monthRuns] of byMonth)
  writeFileSync(
    join(out, 'runs', `${month}.json`),
    JSON.stringify({schemaVersion: 1, month, runs: monthRuns})
  )

const recent = runs.filter(r => Date.parse(r.createdAt) >= END - 30 * DAY)
const stats = wfRuns => {
  const ok = wfRuns.filter(r => r.conclusion === 'success').length
  const failed = wfRuns.filter(r => r.conclusion === 'failure').length
  return {
    runs: wfRuns.length,
    success: ok,
    failure: failed,
    successRate: ok / (ok + failed || 1),
    durationP50Ms: 240_000,
    durationP95Ms: 420_000,
    queueP50Ms: 15_000
  }
}
// Test results for CI runs: suite "unit"; one flaky test, one with an HTML name.
const testKeys = [
  'unit::pkg::adds',
  'unit::pkg::sometimes fails',
  'unit::pkg::<img src=x onerror=alert(1)>'
]
const testMonths = new Map()
for (const r of runs.filter(r => r.workflowId === 1001)) {
  const month = r.createdAt.slice(0, 7)
  const shard = testMonths.get(month) ?? {
    schemaVersion: 1,
    month,
    tests: testKeys,
    runs: [],
    daily: {}
  }
  const flakyFailed = random() < 0.15
  const failed = flakyFailed ? [testKeys[1]] : []
  shard.runs.push({
    runId: r.id,
    attempt: 1,
    suite: 'unit',
    headSha: r.headSha,
    branch: r.branch,
    workflowId: r.workflowId,
    createdAt: r.createdAt,
    total: 3,
    passed: 3 - failed.length,
    failed,
    skipped: []
  })
  if (flakyFailed)
    shard.runs.push({...shard.runs.at(-1), attempt: 2, failed: [], passed: 3})
  const day = (shard.daily[r.createdAt.slice(0, 10)] ??= {})
  testKeys.forEach((_, i) => {
    const ms = Math.round(50 + random() * 400 * (i + 1))
    const [c, f, t, m] = day[i] ?? [0, 0, 0, 0]
    day[i] = [
      c + 1,
      f + (i === 1 && flakyFailed ? 1 : 0),
      t + ms,
      Math.max(m, ms)
    ]
  })
  testMonths.set(month, shard)
}
mkdirSync(join(out, 'tests'), {recursive: true})
for (const [month, shard] of testMonths)
  writeFileSync(join(out, 'tests', `${month}.json`), JSON.stringify(shard))

writeFileSync(
  join(out, 'summary.json'),
  JSON.stringify({
    schemaVersion: 1,
    repository: 'octo-org/octo-repo',
    generatedAt: iso(END),
    syncedThrough: iso(END - DAY),
    recentDays: 30,
    months: [...byMonth.keys()].sort(),
    workflows: workflows.map(w => ({
      id: w.id,
      name: w.name,
      path: w.path,
      recent: stats(recent.filter(r => r.workflowId === w.id))
    })),
    tests: {
      months: [...testMonths.keys()].sort(),
      suites: [
        {
          suite: 'unit',
          recent: {reports: 100, tests: 3, failures: 15, flaky: 1}
        }
      ]
    }
  })
)
writeFileSync(
  join(out, 'state.json'),
  JSON.stringify({schemaVersion: 1, cursor: iso(END - DAY)})
)
