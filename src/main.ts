import * as core from '@actions/core'

async function run(): Promise<void> {
  try {
    const workflows: string = core.getInput('workflows')
    if (workflows === 'all') {
      core.debug(`Collecting stats for all workflows`)
    } else {
      core.debug(`Collecting stats for workflows matching: ${workflows}`)
    }

    const jobs: string = core.getInput('jobs')
    if (jobs === 'all') {
      core.debug(`Collecting stats for all jobs`)
    } else {
      core.debug(`Collecting stats for jobs matching: ${jobs}`)
    }

    core.debug(new Date().toTimeString())
    core.debug(new Date().toTimeString())

    core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
