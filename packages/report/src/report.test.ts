import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {
  buildReport,
  escapeMarkdown,
  readReportConfig,
  summaryMarkdown
} from './report'

const fixture = (name: string) => ({
  path: `reports/${name}`,
  text: readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
})

describe('buildReport', () => {
  it('joins every file into one report for the suite', () => {
    const report = buildReport(
      [fixture('pytest.xml'), fixture('gotest.jsonl')],
      'backend',
      'auto'
    )
    expect(report).toMatchObject({schemaVersion: 1, suite: 'backend'})
    expect(report.tests).toHaveLength(10)
  })

  it('uses the format it is given', () => {
    expect(() =>
      buildReport([fixture('gotest.jsonl')], 'unit', 'junit')
    ).toThrow(/gotest\.jsonl/)
  })

  it('names the file that failed to parse', () => {
    const bad = {path: 'reports/broken.xml', text: '<testsuite>'}
    expect(() => buildReport([bad], 'unit', 'auto')).toThrow(
      /reports\/broken\.xml: .*not valid XML/
    )
  })

  it('refuses no files', () => {
    expect(() => buildReport([], 'unit', 'auto')).toThrow(
      /No test report files/
    )
  })
})

describe('readReportConfig', () => {
  const input = (values: Record<string, string>) => (name: string) =>
    values[name] ?? ''
  const valid = {
    path: 'reports/*.xml',
    suite: 'unit',
    format: 'auto',
    'retention-days': '14'
  }

  it('reads every input, one glob per line', () => {
    expect(
      readReportConfig(input({...valid, path: 'a.xml\n  b/*.json\n'}))
    ).toEqual({
      patterns: ['a.xml', 'b/*.json'],
      suite: 'unit',
      format: 'auto',
      retentionDays: 14
    })
  })

  it.each([
    ['an empty path', {path: ''}, /path/],
    ['a suite label with spaces', {suite: 'my suite'}, /suite/],
    ['an unknown format', {format: 'trx'}, /format/],
    ['a retention over 90 days', {'retention-days': '91'}, /retention-days/]
  ])('refuses %s', (_, change, message) => {
    expect(() => readReportConfig(input({...valid, ...change}))).toThrow(
      message
    )
  })
})

describe('summaryMarkdown', () => {
  it('counts results and lists failed tests', () => {
    const report = buildReport([fixture('pytest.xml')], 'engine', 'auto')
    const md = summaryMarkdown(report, 20)
    expect(md).toContain('**engine**: 5 tests, 2 passed, 2 failed, 1 skipped')
    expect(md).toContain('- tests.test\\_maths :: test\\_divides')
  })

  it('caps the list of failures', () => {
    const report = buildReport([fixture('pytest.xml')], 'engine', 'auto')
    expect(summaryMarkdown(report, 1)).toContain('and 1 more')
  })
})

describe('escapeMarkdown', () => {
  it('neutralises HTML and Markdown in untrusted names', () => {
    expect(
      escapeMarkdown('<img src=x onerror=alert(1)> *bold* [link](x) `code`')
    ).toBe(
      '&lt;img src=x onerror=alert(1)&gt; \\*bold\\* \\[link\\](x) \\`code\\`'
    )
  })
})
