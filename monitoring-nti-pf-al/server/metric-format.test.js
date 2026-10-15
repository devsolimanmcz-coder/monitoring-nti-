import test from 'node:test'
import assert from 'node:assert/strict'
import { formatMetricSeries } from '../src/metric-format.js'

test('scales bit-rate and byte-rate metrics without changing series ratios', () => {
  assert.deepEqual(formatMetricSeries([1_000_000, 2_000_000], 'bps'), {
    values: [1, 2],
    unit: 'Mbps',
  })
  assert.deepEqual(formatMetricSeries([1_048_576, 2_097_152], 'Bps'), {
    values: [1, 2],
    unit: 'MB/s',
  })
})

test('scales byte quantities and durations to readable units', () => {
  assert.deepEqual(formatMetricSeries([1_073_741_824], 'B'), {
    values: [1],
    unit: 'GB',
  })
  assert.deepEqual(formatMetricSeries([0.025, 0.05], 's'), {
    values: [25, 50],
    unit: 'ms',
  })
  assert.deepEqual(formatMetricSeries([120, 240], 'seconds'), {
    values: [2, 4],
    unit: 'min',
  })
})

test('leaves unknown units unchanged', () => {
  assert.deepEqual(formatMetricSeries([30, 60], '%'), {
    values: [30, 60],
    unit: '%',
  })
})
