// Hash routes: every view and filter lives in the URL, so any view is a link.

export type Days = 7 | 30 | 90 | 'all'
export const DAY_CHOICES: Days[] = [7, 30, 90, 'all']
const DEFAULT_DAYS: Days = 30

export type Route =
  | {view: 'overview'}
  | {view: 'not-found'}
  | {view: 'workflow'; id: number; branch?: string; days: Days}

function parseDays(value: string | null): Days {
  return DAY_CHOICES.find(d => String(d) === value) ?? DEFAULT_DAYS
}

/** Reads a route from `location.hash`; anything unknown is not-found. */
export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?', 2)
  const params = new URLSearchParams(query)
  if (path === '' || path === '/') return {view: 'overview'}
  const workflow = /^\/workflow\/(\d+)$/.exec(path)
  if (workflow?.[1] === undefined) return {view: 'not-found'}
  const branch = params.get('branch')
  return {
    view: 'workflow',
    id: Number(workflow[1]),
    ...(branch === null ? {} : {branch}),
    days: parseDays(params.get('days'))
  }
}

/** Writes a route as a hash, leaving default filters out. */
export function formatRoute(route: Route): string {
  if (route.view !== 'workflow') return '#/'
  const params = new URLSearchParams()
  if (route.branch !== undefined) params.set('branch', route.branch)
  if (route.days !== DEFAULT_DAYS) params.set('days', String(route.days))
  const query = params.toString()
  return `#/workflow/${route.id}${query === '' ? '' : `?${query}`}`
}
