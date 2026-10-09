// The Action's entry point: wires inputs, Octokit and the clock into collect().

import * as core from '@actions/core'
import {DefaultArtifactClient} from '@actions/artifact'
import {context, getOctokit} from '@actions/github'
import {collect} from './collect'
import {assertNotDefaultBranch, readConfig} from './config'
import {
  octokitArtifactsApi,
  octokitDataStore,
  octokitRunsApi,
  type Request
} from './octokit'

async function main(): Promise<void> {
  const config = readConfig(core.getInput, process.env)
  const request = getOctokit(config.token).request as unknown as Request
  const dataOctokit = getOctokit(config.dataToken)
  const repo = {owner: config.owner, repo: config.repo}
  const dataRepo = {owner: config.dataOwner, repo: config.dataRepo}
  const sameRepo =
    config.dataOwner === config.owner && config.dataRepo === config.repo
  const defaultBranch =
    (sameRepo
      ? (context.payload.repository?.default_branch as string | undefined)
      : undefined) ??
    (await dataOctokit.rest.repos.get(dataRepo).then(
      r => r.data.default_branch,
      (error: unknown) => {
        throw new Error(
          `Cannot read data-repository ${config.dataOwner}/${config.dataRepo}: ${error instanceof Error ? error.message : String(error)}. Check the name, and that data-token can access it.`,
          {cause: error}
        )
      }
    ))
  assertNotDefaultBranch(config, defaultBranch)

  const artifacts = new DefaultArtifactClient()
  const api = {
    ...octokitRunsApi(request, repo),
    ...octokitArtifactsApi(request, repo, async (id, runId, dir) => {
      await artifacts.downloadArtifact(id, {
        path: dir,
        findBy: {
          token: config.token,
          workflowRunId: runId,
          repositoryOwner: config.owner,
          repositoryName: config.repo
        }
      })
    })
  }
  const result = await collect(
    api,
    octokitDataStore(
      dataOctokit.request as unknown as Request,
      dataRepo,
      config.dataBranch
    ),
    // eslint-disable-next-line no-restricted-syntax -- the wiring layer owns the clock
    new Date(),
    {
      repository: `${config.owner}/${config.repo}`,
      backfillDays: config.backfillDays,
      maxRequests: config.maxRequests,
      recentDays: config.recentDays
    }
  )

  core.setOutput('runs-added', result.runsAdded)
  core.setOutput('complete', result.complete)
  core.setOutput('synced-through', result.syncedThrough)
  core.info(
    `Collected ${result.runsAdded} runs; data complete through ${result.syncedThrough}`
  )
  for (const warning of result.warnings) core.warning(warning)
  if (!result.complete)
    core.warning(
      `Stopped early (${result.stoppedBy ?? 'unknown'}). The next run resumes from here.`
    )
  await core.summary
    .addHeading('Workflow stats collection', 3)
    .addList([
      `Runs added: ${result.runsAdded}`,
      `Data complete through: ${result.syncedThrough}`,
      `Finished: ${result.complete ? 'yes' : 'no, the next run resumes'}`,
      `Test reports skipped: ${result.warnings.length} (see the warnings)`
    ])
    .write()
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
