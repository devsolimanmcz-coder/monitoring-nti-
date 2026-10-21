import test from 'node:test'
import assert from 'node:assert/strict'
import { capacityInDisplayUnit } from '../src/capacity-format.js'

test('formats server capacities in MB, GB, or TB from their GiB source values', () => {
  assert.deepEqual(capacityInDisplayUnit(0.5), { value: 512, unit: 'MB' })
  assert.deepEqual(capacityInDisplayUnit(255.5), { value: 255.5, unit: 'GB' })
  assert.deepEqual(capacityInDisplayUnit(1024), { value: 1, unit: 'TB' })
  assert.deepEqual(capacityInDisplayUnit(45690), { value: 44.619140625, unit: 'TB' })
})

test('rejects missing, negative, and non-finite capacity values', () => {
  assert.equal(capacityInDisplayUnit(null), null)
  assert.equal(capacityInDisplayUnit(-1), null)
  assert.equal(capacityInDisplayUnit(Number.NaN), null)
})
