// Fetches the report artifacts of collected runs into monthly test shards,
// within a request budget; what it cannot reach stays pending for next time.

import {
  TEST_ARTIFACT_PREFIX,
  addReport,
  validateTestReport,
  type PendingTests,
  type RunRecord,
  type TestShard
} from '@gh-workflow-stats/core'
import type {ApiArtifact, ArtifactsApi} from './github'
import {RateLimitError} from './sync'

/** Larger report artifacts are skipped: 20 MB is far beyond any real suite. */
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024

export interface TestsOptions {
  api: ArtifactsApi
  queue: PendingTests[]
  /** The stored run for a pending entry, or undefined if it was replaced. */
  findRun: (pending: PendingTests) => RunRecord | undefined
  loadShard: (month: string) => Promise<TestShard>
  budget: number
}

export interface TestsResult {
  shards: Map<string, TestShard>
  pending: PendingTests[]
  warnings: string[]
  stoppedBy?: string
}

class Stop extends Error {}

/** The newest artifact of each name: a re-run's report replaces the earlier attempt's. */
function newestByName(artifacts: ApiArtifact[]): ApiArtifact[] {
  const newest = new Map<string, ApiArtifact>()
  for (const a of artifacts) {
    const held = newest.get(a.name)
    const later =
      held === undefined ||
      (a.created_at ?? '') > (held.created_at ?? '') ||
      (a.created_at === held.created_at && a.id > held.id)
    if (later) newest.set(a.name, a)
  }
  return [...newest.values()]
}

/** Adds each queued run's reports to its month's shard; see TestsResult. */
export async function collectTests(opts: TestsOptions): Promise<TestsResult> {
  const shards = new Map<string, TestShard>()
  const warnings: string[] = []
  let budget = opts.budget
  const spend = (): void => {
    if (budget < 1) throw new Stop('request budget')
    budget--
  }

  for (const [i, item] of opts.queue.entries()) {
    const run = opts.findRun(item)
    if (run === undefined) continue
    try {
      spend()
      const artifacts = newestByName(
        (await opts.api.listArtifacts(run.id)).filter(
          a => a.name.startsWith(TEST_ARTIFACT_PREFIX) && !a.expired
        )
      )
      for (const artifact of artifacts) {
        if (artifact.size_in_bytes > MAX_ARTIFACT_BYTES) {
          warnings.push(
            `run ${run.id}: ${artifact.name} is over 20 MB; skipped`
          )
          continue
        }
        spend()
        const text = await opts.api.downloadText(artifact.id, run.id)
        try {
          const report = validateTestReport(JSON.parse(text))
          if (artifact.name !== `${TEST_ARTIFACT_PREFIX}${report.suite}.json`)
            throw new Error(
              `suite ${report.suite} does not match the artifact name`
            )
          const month = item.month
          const shard = shards.get(month) ?? (await opts.loadShard(month))
          shards.set(month, addReport(shard, run, report))
        } catch (error) {
          warnings.push(
            `run ${run.id}: ${artifact.name}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    } catch (error) {
      if (!(error instanceof Stop || error instanceof RateLimitError))
        throw error
      return {
        shards,
        pending: opts.queue.slice(i),
        warnings,
        stoppedBy:
          error instanceof RateLimitError
            ? `rate limit: ${error.message}`
            : error.message
      }
    }
  }
  return {shards, pending: [], warnings}
}
