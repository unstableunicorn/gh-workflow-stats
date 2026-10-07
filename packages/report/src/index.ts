// The report Action's entry point: finds report files, writes one normalized
// report, uploads it as an artifact and adds a job summary.

import {readFile, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import * as core from '@actions/core'
import * as glob from '@actions/glob'
import {DefaultArtifactClient} from '@actions/artifact'
import {TEST_ARTIFACT_PREFIX} from '@gh-workflow-stats/core'
import {buildReport, readReportConfig, summaryMarkdown} from './report'

async function main(): Promise<void> {
  const config = readReportConfig(core.getInput)
  const globber = await glob.create(config.patterns.join('\n'), {
    matchDirectories: false
  })
  const paths = await globber.glob()
  const files = await Promise.all(
    paths.map(async path => ({path, text: await readFile(path, 'utf8')}))
  )
  const report = buildReport(files, config.suite, config.format)

  const dir = await mkdtemp(
    join(process.env.RUNNER_TEMP ?? tmpdir(), 'gws-report-')
  )
  const name = `${TEST_ARTIFACT_PREFIX}${config.suite}.json`
  const file = join(dir, name)
  await writeFile(file, JSON.stringify(report))
  await new DefaultArtifactClient().uploadArtifact(name, [file], dir, {
    retentionDays: config.retentionDays,
    skipArchive: true
  })

  const failed = report.tests.filter(t => t.status === 'failed').length
  core.setOutput('tests', report.tests.length)
  core.setOutput('failed', failed)
  core.info(
    `${paths.length} file(s), ${report.tests.length} tests, ${failed} failed; uploaded ${name}`
  )
  await core.summary.addRaw(summaryMarkdown(report, 20)).write()
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error))
})
