import test from 'node:test'
import assert from 'node:assert/strict'
import { formatMetricSeries, formatMetricSeriesGroups } from '../src/metric-format.js'

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

test('formats graph series with different units on independent scales', () => {
  const result = formatMetricSeriesGroups([
    { itemId: 1, originalUnit: 'bps', rawValues: [1_000_000, 2_000_000] },
    { itemId: 2, originalUnit: '', rawValues: [10, 20] },
    { itemId: 3, originalUnit: 'Bps', rawValues: [1_024, 2_048] },
  ])

  assert.deepEqual(result.axes.map((axis) => axis.unit), ['Mbps', '', 'KB/s'])
  assert.deepEqual(result.series.map((item) => ({
    itemId: item.itemId,
    axisId: item.axisId,
    unit: item.unit,
    values: item.values,
  })), [
    { itemId: 1, axisId: 'y0', unit: 'Mbps', values: [1, 2] },
    { itemId: 2, axisId: 'y1', unit: '', values: [10, 20] },
    { itemId: 3, axisId: 'y2', unit: 'KB/s', values: [1, 2] },
  ])
})
