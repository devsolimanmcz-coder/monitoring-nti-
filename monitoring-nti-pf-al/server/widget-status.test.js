import test from 'node:test'
import assert from 'node:assert/strict'
import { getAvailabilityStatus } from '../src/widget-status.js'

function samples(now, values) {
  return values.map(([secondsAgo, value]) => ({
    time: new Date(now - secondsAgo * 1000).toISOString(),
    value,
  })).reverse()
}

test('availability reports a current zero as down', () => {
  const now = Date.now()
  assert.deepEqual(getAvailabilityStatus(samples(now, [[15, 1], [5, 0]]), now), {
    state: 'down',
    label: 'DOWN',
  })
})

test('availability marks recovery for 30 seconds before turning up', () => {
  const now = Date.now()
  assert.equal(getAvailabilityStatus(samples(now, [[20, 0], [10, 1]]), now).state, 'recovering')
  assert.equal(getAvailabilityStatus(samples(now, [[60, 0], [40, 1], [10, 1]]), now).state, 'up')
})

test('availability reports repeated transitions as flapping', () => {
  const now = Date.now()
  assert.equal(getAvailabilityStatus(samples(now, [[40, 1], [30, 0], [20, 1], [10, 0], [2, 1]]), now).state, 'flapping')
})

test('availability reports missing or stale samples as unknown', () => {
  const now = Date.now()
  assert.equal(getAvailabilityStatus([], now).state, 'unknown')
  assert.equal(getAvailabilityStatus(samples(now, [[181, 1]]), now).state, 'unknown')
})
