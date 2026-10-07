// The report step's logic: validate inputs, parse each file into one
// normalized TestReport, and describe it in the job summary.

import {
  SUITE_LABEL,
  TEST_SCHEMA_VERSION,
  validateTestReport,
  type TestReport
} from '@gh-workflow-stats/core'
import {detectFormat, parseGoTestJson, parseJunit, type Format} from './parse'

export interface ReportConfig {
  patterns: string[]
  suite: string
  format: Format | 'auto'
  retentionDays: number
}

const FORMATS = new Set(['auto', 'junit', 'go-json'])

/** Reads and validates the inputs; anything unexpected stops the step. */
export function readReportConfig(
  input: (name: string) => string
): ReportConfig {
  const patterns = input('path')
    .split('\n')
    .map(p => p.trim())
    .filter(p => p !== '')
  if (patterns.length === 0)
    throw new Error('Input path is required: one glob per line')
  const suite = input('suite').trim()
  if (!SUITE_LABEL.test(suite))
    throw new Error(
      `Input suite must be 1-64 letters, digits, '.', '_' or '-': ${JSON.stringify(suite)}`
    )
  const format = input('format').trim() || 'auto'
  if (!FORMATS.has(format))
    throw new Error(
      `Input format must be auto, junit or go-json: ${JSON.stringify(format)}`
    )
  const retentionDays = Number(input('retention-days').trim() || '14')
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 90
  )
    throw new Error('Input retention-days must be a whole number from 1 to 90')
  return {
    patterns,
    suite,
    format: format as ReportConfig['format'],
    retentionDays
  }
}

/** Parses every file into one report for `suite`, naming any file that fails. */
export function buildReport(
  files: {path: string; text: string}[],
  suite: string,
  format: ReportConfig['format']
): TestReport {
  if (files.length === 0)
    throw new Error('No test report files matched the path input')
  const tests = files.flatMap(file => {
    try {
      const fileFormat = format === 'auto' ? detectFormat(file.text) : format
      return fileFormat === 'junit'
        ? parseJunit(file.text)
        : parseGoTestJson(file.text)
    } catch (error) {
      throw new Error(
        `${file.path}: ${error instanceof Error ? error.message : String(error)}`,
        {cause: error}
      )
    }
  })
  return validateTestReport({schemaVersion: TEST_SCHEMA_VERSION, suite, tests})
}

/** Escapes text so Markdown and HTML in it render literally. */
export function escapeMarkdown(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]|#])/g, '\\$1')
}

/** The job summary: counts, then up to `maxFailures` failed tests. */
export function summaryMarkdown(
  report: TestReport,
  maxFailures: number
): string {
  const count = (status: string) =>
    report.tests.filter(t => t.status === status).length
  const failed = report.tests.filter(t => t.status === 'failed')
  const lines = [
    `### Test report`,
    '',
    `**${escapeMarkdown(report.suite)}**: ${report.tests.length} tests, ${count('passed')} passed, ${failed.length} failed, ${count('skipped')} skipped`
  ]
  if (failed.length > 0) {
    lines.push('', 'Failed:', '')
    for (const t of failed.slice(0, maxFailures))
      lines.push(
        `- ${escapeMarkdown(t.classname === '' ? t.name : `${t.classname} :: ${t.name}`)}`
      )
    if (failed.length > maxFailures)
      lines.push(`- and ${failed.length - maxFailures} more`)
  }
  return `${lines.join('\n')}\n`
}
