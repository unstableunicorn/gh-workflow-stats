// Entry point: wires the real fetch and clock into the app.

import {render} from 'preact'
import {App} from './components/App'
import './styles/tokens.css'
import './styles/base.css'

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path, {cache: 'no-cache'})
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

const root = document.getElementById('app')
// eslint-disable-next-line no-restricted-syntax -- the wiring layer owns the clock
if (root !== null) render(<App fetchJson={fetchJson} now={new Date()} />, root)
