// Loads the built site with fixture data under a sub-path in headless Chromium
// and fails on any console error (CSP included), third-party request or HTML.
// Usage: node fixtures/smoke.mjs   (after `vite build`)

import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {extname, join, normalize} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright'

const site = fileURLToPath(new URL('..', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'gws-smoke-'))
const base = join(root, 'sub', 'path')
cpSync(join(site, 'dist'), base, {recursive: true})
execFileSync(process.execPath, [
  join(site, 'fixtures', 'make-fixtures.mjs'),
  join(base, 'data')
])

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
}
const server = createServer((req, res) => {
  const path = normalize(
    decodeURIComponent(new URL(req.url, 'http://x').pathname)
  )
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path)
  try {
    const body = readFileSync(file)
    res.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream'
    })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const failures = []
const check = (ok, message) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`)
  if (!ok) failures.push(message)
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on(
    'console',
    m => m.type() === 'error' && failures.push(`console: ${m.text()}`)
  )
  page.on('pageerror', e => failures.push(`page error: ${e.message}`))
  page.on(
    'request',
    r =>
      !r.url().startsWith(origin) &&
      failures.push(`third-party request: ${r.url()}`)
  )

  await page.goto(`${origin}/sub/path/`)
  await page.waitForSelector('table caption')
  check(
    (await page
      .locator('table:has(caption:has-text("Workflows")) tbody tr')
      .count()) === 2,
    'overview lists both fixture workflows'
  )

  await page.click('text=CI')
  await page.waitForSelector('canvas')
  check(
    new URL(page.url()).hash === '#/workflow/1001',
    'a workflow link opens its view'
  )
  check(
    (await page.locator('.chart canvas').count()) >= 2,
    'both charts render'
  )

  await page.selectOption('select >> nth=0', 'fix/<b>not-html</b>')
  await page.waitForSelector('td:has-text("<b>not-html</b>")')
  check(
    new URL(page.url()).hash.includes('branch='),
    'the branch filter is kept in the URL'
  )
  check(
    (await page.locator('table b').count()) === 0,
    'a branch name with HTML renders as text'
  )

  await page.click('nav >> text=Tests')
  await page.waitForSelector('caption:has-text("Flaky tests")')
  check(
    (await page.locator('tr:has-text("sometimes fails")').count()) >= 1,
    'the flaky test is listed'
  )
  check(
    (await page.locator('main img').count()) === 0,
    'a test name with HTML renders as text'
  )
  await page.click('a:has-text("sometimes fails") >> nth=0')
  await page.waitForSelector('#test-title')
  await page.waitForSelector('.chart canvas', {timeout: 10_000}).catch(() => {})
  check(
    (await page.locator('#test-title').innerText()) === 'pkg::sometimes fails',
    'a test link opens its history'
  )
  check(
    (await page.locator('.chart canvas').count()) >= 1,
    'the test history chart renders'
  )
} finally {
  await browser.close()
  server.close()
  rmSync(root, {recursive: true, force: true})
}

for (const f of failures) console.error(`  FAIL ${f}`)
if (failures.length > 0) process.exit(1)
console.log('  site smoke: loaded under /sub/path/ with no errors')
