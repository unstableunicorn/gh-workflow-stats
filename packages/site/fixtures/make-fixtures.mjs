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
    }))
  })
)
writeFileSync(
  join(out, 'state.json'),
  JSON.stringify({schemaVersion: 1, cursor: iso(END - DAY)})
)
