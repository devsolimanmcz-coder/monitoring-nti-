import assert from 'node:assert/strict'
import test from 'node:test'
import { getSnappedNodePosition } from '../src/topology-alignment.js'

test('snaps node edges to nearby nodes and returns vertical alignment guides', () => {
  const moving = { id: 'moving', width: 100, height: 60, position: { x: 0, y: 0 } }
  const target = { id: 'target', width: 100, height: 60, position: { x: 200, y: 100 } }

  assert.deepEqual(
    getSnappedNodePosition(moving, { x: 107, y: 104 }, [moving, target]),
    {
      position: { x: 100, y: 100 },
      guides: { x: 200, y: 100 },
    },
  )
})

test('aligns centers using measured dimensions and does not snap beyond threshold', () => {
  const moving = { id: 'moving', measured: { width: 80, height: 40 }, position: { x: 0, y: 0 } }
  const target = { id: 'target', measured: { width: 120, height: 60 }, position: { x: 200, y: 100 } }
  const aligned = getSnappedNodePosition(moving, { x: 223, y: 112 }, [target])
  const distant = getSnappedNodePosition(moving, { x: 150, y: 40 }, [target])

  assert.deepEqual(aligned, {
    position: { x: 220, y: 110 },
    guides: { x: 260, y: 130 },
  })
  assert.deepEqual(distant, {
    position: { x: 150, y: 40 },
    guides: { x: null, y: null },
  })
})
