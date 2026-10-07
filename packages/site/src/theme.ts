// Reads chart colours from the CSS tokens, so charts follow light and dark.

import type {Theme} from './lib/charts'

/** The current Theme from the root element's custom properties. */
export function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string): string =>
    style.getPropertyValue(`--color-${name}`).trim()
  return {
    text: token('text'),
    grid: token('border'),
    success: token('success'),
    failure: token('failure'),
    other: token('other'),
    accent: token('accent')
  }
}
