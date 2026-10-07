// Parsers from test runner output to TestCase lists: JUnit XML (pytest, Vitest,
// Jest, gotestsum and most others) and `go test -json`.

import {XMLParser, XMLValidator} from 'fast-xml-parser'
import type {TestCase, TestStatus} from '@gh-workflow-stats/core'

export type Format = 'junit' | 'go-json'

/** Guesses the format from the first character; throws if it is neither. */
export function detectFormat(text: string): Format {
  const start = text.replace(/^\ufeff/, '').trimStart()
  if (start.startsWith('<')) return 'junit'
  if (start.startsWith('{')) return 'go-json'
  throw new Error('Report is neither JUnit XML or go test -json output')
}

/** Seconds as JUnit writes them ("0.25", "1,5", "1,234.5") to ms; 0 if unreadable. */
function secondsToMs(value: unknown): number {
  if (typeof value !== 'string') return 0
  const normalised = value.includes('.')
    ? value.replaceAll(',', '')
    : value.replace(',', '.')
  const seconds = Number(normalised)
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1000)
    : 0
}

interface XmlNode {
  '@'?: Record<string, string>
  testsuite?: XmlNode[]
  testcase?: XmlNode[]
  failure?: unknown
  error?: unknown
  skipped?: unknown
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  htmlEntities: false,
  isArray: name => name === 'testsuite' || name === 'testcase'
})

/** Every test case in a JUnit XML report, in document order per suite. */
export function parseJunit(xml: string): TestCase[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error(
      'Report contains a DOCTYPE or ENTITY declaration, which JUnit reports never need'
    )
  const valid = XMLValidator.validate(xml)
  if (valid !== true)
    throw new Error(
      `Report is not valid XML: ${valid.err.msg} (line ${valid.err.line})`
    )

  const root = parser.parse(xml) as {
    testsuites?: XmlNode
    testsuite?: XmlNode[]
  }
  const suites = root.testsuites?.testsuite ?? root.testsuite
  if (suites === undefined && root.testsuites === undefined)
    throw new Error('Report has no <testsuites> or <testsuite> element')

  const tests: TestCase[] = []
  const walk = (suite: XmlNode): void => {
    const suiteName = suite['@']?.name ?? ''
    for (const c of suite.testcase ?? []) {
      const status: TestStatus =
        c.failure !== undefined || c.error !== undefined
          ? 'failed'
          : c.skipped !== undefined
            ? 'skipped'
            : 'passed'
      tests.push({
        classname: c['@']?.classname ?? suiteName,
        name: c['@']?.name ?? '',
        status,
        durationMs: secondsToMs(c['@']?.time)
      })
    }
    for (const nested of suite.testsuite ?? []) walk(nested)
  }
  for (const suite of suites ?? []) walk(suite)
  return tests
}

interface GoEvent {
  Action?: string
  Package?: string
  Test?: string
  Elapsed?: number
}

/** Every test in `go test -json` output; a package failing without a failed test becomes `(package)`. */
export function parseGoTestJson(text: string): TestCase[] {
  const results = new Map<string, TestCase>()
  const failedPackages: string[] = []
  const packagesWithFailure = new Set<string>()

  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return
    let event: GoEvent
    try {
      event = JSON.parse(line) as GoEvent
    } catch {
      throw new Error(
        `go test -json output has a line that is not JSON: line ${i + 1}`
      )
    }
    const pkg = event.Package ?? ''
    if (event.Test === undefined) {
      if (event.Action === 'fail') failedPackages.push(pkg)
      return
    }
    const id = `${pkg}\u0000${event.Test}`
    const status = {pass: 'passed', fail: 'failed', skip: 'skipped'}[
      event.Action ?? ''
    ] as TestStatus | undefined
    if (event.Action === 'run' && !results.has(id))
      results.set(id, {
        classname: pkg,
        name: event.Test,
        status: 'failed',
        durationMs: 0
      })
    if (status !== undefined) {
      results.set(id, {
        classname: pkg,
        name: event.Test,
        status,
        durationMs: Math.round((event.Elapsed ?? 0) * 1000)
      })
      if (status === 'failed') packagesWithFailure.add(pkg)
    }
  })

  for (const t of results.values())
    if (t.status === 'failed') packagesWithFailure.add(t.classname)
  const tests = [...results.values()]
  for (const pkg of failedPackages)
    if (!packagesWithFailure.has(pkg))
      tests.push({
        classname: pkg,
        name: '(package)',
        status: 'failed',
        durationMs: 0
      })
  return tests
}
