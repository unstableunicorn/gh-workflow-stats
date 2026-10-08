import {expect, it} from 'vitest'

it('deliberately flaky (dashboard check, never merge)', () => {
  expect(Math.random()).toBeGreaterThanOrEqual(0.5)
})
