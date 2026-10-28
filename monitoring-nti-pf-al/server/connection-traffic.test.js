import test from 'node:test'
import assert from 'node:assert/strict'
import {
  connectionTrafficMbps,
  getConnectionHealth,
  getConnectionTrafficItems,
  getTrafficDirection,
  isSupportedTrafficUnit,
} from '../src/connection-traffic.js'

test('sets link health color from ping states and supports healthy color options', () => {
  assert.deepEqual(getConnectionHealth('down', 'up', 'blue'), { state: 'down', color: '#ff594f' })
  assert.deepEqual(getConnectionHealth('up', 'up'), { state: 'up', color: '#47d7a0' })
  assert.deepEqual(getConnectionHealth('up', 'up', 'blue'), { state: 'up', color: '#38bdf8' })
  assert.deepEqual(getConnectionHealth('up', 'unknown'), { state: 'unknown', color: '#8492a6' })
})

test('identifies inbound and outbound interface metrics', () => {
  assert.equal(getTrafficDirection('net.if.in[eth0]'), 'RECEBIDO')
  assert.equal(getTrafficDirection('net.if.out[eth0]'), 'ENVIADO')
  assert.equal(getTrafficDirection('system.cpu.util'), '')
})

test('includes traffic configured on organization topology sections', () => {
  const connections = [
    { id: 'section-map-link', trafficItem: { itemId: 123 } },
    { id: 'unconfigured-link' },
  ]

  assert.deepEqual(getConnectionTrafficItems(connections), [connections[0]])
})

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
