import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionTrafficMbps, isSupportedTrafficUnit } from '../src/connection-traffic.js'

test('converts bit and byte rates to Mbps', () => {
  const points = [{ time: '2026-10-27T13:00:00.000Z', value: 12_500_000 }]
  assert.equal(connectionTrafficMbps(points, 'bps'), 12.5)
  assert.equal(connectionTrafficMbps(points, 'Bps'), 100)
})

test('calculates Mbps from byte-counter samples and ignores counter resets', () => {
  const points = [
    { time: '2026-10-27T13:00:00.000Z', value: 50_000_000 },
    { time: '2026-10-27T13:00:01.000Z', value: 51_000_000 },
    { time: '2026-10-27T13:00:02.000Z', value: 100 },
    { time: '2026-10-27T13:00:03.000Z', value: 1_100_100 },
  ]
  assert.equal(connectionTrafficMbps(points, 'B'), 8.8)
  assert.equal(connectionTrafficMbps(points.slice(2, 3), 'bytes'), null)
})

test('rejects unsupported traffic units and missing samples', () => {
  assert.equal(isSupportedTrafficUnit('Mbps'), false)
  assert.equal(isSupportedTrafficUnit('Bps'), true)
  assert.equal(connectionTrafficMbps([], 'bps'), null)
  assert.equal(connectionTrafficMbps([{ time: 'invalid', value: 1 }], 'bps'), null)
  assert.equal(connectionTrafficMbps([{ time: '2026-10-27T13:00:00.000Z', value: null }], 'bps'), null)
})
