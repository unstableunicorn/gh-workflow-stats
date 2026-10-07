import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {detectFormat, parseGoTestJson, parseJunit} from './parse'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const summary = (tests: {classname: string; name: string; status: string}[]) =>
  tests.map(t => `${t.status} ${t.classname} :: ${t.name}`)

describe('parseJunit', () => {
  it('reads pytest output: failures, errors and skips', () => {
    expect(summary(parseJunit(fixture('pytest.xml')))).toEqual([
      'passed tests.test_maths :: test_adds',
      'failed tests.test_maths :: test_divides',
      'skipped tests.test_maths :: test_later',
      'failed tests.test_io :: test_reads[a&b]',
      'passed tests.test_io :: test_writes'
    ])
  })

  it('reads Vitest output, including an empty suite', () => {
    expect(summary(parseJunit(fixture('vitest.xml')))).toEqual([
      'passed src/lib/route.test.ts :: parseRoute > reads the overview',
      'failed src/lib/route.test.ts :: parseRoute > reads a workflow',
      'passed src/lib/format.test.ts :: formatDuration > shows a dash'
    ])
  })

  it('reads gotestsum output, with subtests', () => {
    expect(summary(parseJunit(fixture('gotestsum.xml')))).toEqual([
      'passed example.com/octo/api :: TestHealth',
      'failed example.com/octo/api :: TestLogin/bad_password'
    ])
  })

  it('converts seconds to milliseconds', () => {
    expect(parseJunit(fixture('pytest.xml'))[1]?.durationMs).toBe(250)
  })

  it('reads a bare testsuite root, a decimal comma, and a missing classname', () => {
    expect(parseJunit(fixture('single-suite.xml'))).toEqual([
      {classname: 'Root', name: 'works', status: 'passed', durationMs: 1500}
    ])
  })

  it('treats a missing or unreadable time as zero', () => {
    const xml =
      '<testsuite name="s"><testcase name="a" time="soon"/><testcase name="b"/></testsuite>'
    expect(parseJunit(xml).map(t => t.durationMs)).toEqual([0, 0])
  })

  it('refuses a document type declaration before parsing', () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><testsuite name="s"/>'
    expect(() => parseJunit(xml)).toThrow(/DOCTYPE/)
  })

  it('refuses malformed XML', () => {
    expect(() => parseJunit('<testsuite name="s"><testcase name="a">')).toThrow(
      /not valid XML/
    )
  })

  it('refuses XML that is not a JUnit report', () => {
    expect(() => parseJunit('<coverage line-rate="1"/>')).toThrow(/testsuite/)
  })
})

describe('parseGoTestJson', () => {
  const tests = parseGoTestJson(fixture('gotest.jsonl'))

  it('reads each test result in start order, subtests included', () => {
    expect(summary(tests)).toEqual([
      'passed example.com/octo/api :: TestHealth',
      'failed example.com/octo/api :: TestLogin',
      'failed example.com/octo/api :: TestLogin/bad_password',
      'skipped example.com/octo/api :: TestLater',
      'failed example.com/octo/broken :: (package)'
    ])
  })

  it('records a package that failed with no failing test, so it is not lost', () => {
    expect(tests.find(t => t.name === '(package)')?.classname).toBe(
      'example.com/octo/broken'
    )
  })

  it('counts a test that started but never finished as failed', () => {
    const lines = [
      '{"Action":"run","Package":"p","Test":"TestHangs"}',
      '{"Action":"fail","Package":"p","Elapsed":600}'
    ].join('\n')
    expect(summary(parseGoTestJson(lines))).toEqual(['failed p :: TestHangs'])
  })

  it('refuses a line that is not JSON', () => {
    expect(() => parseGoTestJson('{"Action":"run"}\nnot json')).toThrow(
      /line 2/
    )
  })
})

describe('detectFormat', () => {
  it('tells JUnit XML from go test JSON', () => {
    expect(detectFormat('\ufeff  <?xml version="1.0"?>')).toBe('junit')
    expect(detectFormat('{"Action":"start"}')).toBe('go-json')
  })

  it('refuses anything else', () => {
    expect(() => detectFormat('PASS ok')).toThrow(/JUnit XML or go test -json/)
  })
})
