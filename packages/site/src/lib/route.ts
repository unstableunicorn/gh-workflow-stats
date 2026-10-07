// Hash routes: every view and filter lives in the URL, so any view is a link.

export type Days = 7 | 30 | 90 | 'all'
export const DAY_CHOICES: Days[] = [7, 30, 90, 'all']
const DEFAULT_DAYS: Days = 30

export type Route =
  | {view: 'overview'}
  | {view: 'not-found'}
  | {view: 'workflow'; id: number; branch?: string; days: Days}
  | {view: 'tests'; suite?: string; days: Days}
  | {view: 'test'; key: string; days: Days}

function parseDays(value: string | null): Days {
  return DAY_CHOICES.find(d => String(d) === value) ?? DEFAULT_DAYS
}

/** Reads a route from `location.hash`; anything unknown is not-found. */
export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?', 2)
  const params = new URLSearchParams(query)
  const days = parseDays(params.get('days'))
  if (path === '' || path === '/') return {view: 'overview'}
  if (path === '/tests') {
    const suite = params.get('suite')
    return {view: 'tests', ...(suite === null ? {} : {suite}), days}
  }
  if (path === '/test') {
    const key = params.get('key')
    return key === null || key === ''
      ? {view: 'not-found'}
      : {view: 'test', key, days}
  }
  const workflow = /^\/workflow\/(\d+)$/.exec(path)
  if (workflow?.[1] === undefined) return {view: 'not-found'}
  const branch = params.get('branch')
  return {
    view: 'workflow',
    id: Number(workflow[1]),
    ...(branch === null ? {} : {branch}),
    days
  }
}

/** Writes a route as a hash, leaving default filters out. */
export function formatRoute(route: Route): string {
  if (route.view === 'overview' || route.view === 'not-found') return '#/'
  const params = new URLSearchParams()
  if (route.view === 'workflow' && route.branch !== undefined)
    params.set('branch', route.branch)
  if (route.view === 'tests' && route.suite !== undefined)
    params.set('suite', route.suite)
  if (route.view === 'test') params.set('key', route.key)
  if (route.days !== DEFAULT_DAYS) params.set('days', String(route.days))
  const query = params.toString()
  const path =
    route.view === 'workflow' ? `/workflow/${route.id}` : `/${route.view}`
  return `#${path}${query === '' ? '' : `?${query}`}`
}
