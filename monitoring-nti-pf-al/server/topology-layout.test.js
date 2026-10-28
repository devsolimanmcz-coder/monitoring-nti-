import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLayoutMapPositions } from '../src/topology-layout.js'

test('persists generated topology positions without moving existing widgets', () => {
  const layout = {
    type: 'general',
    sections: [
      { id: 'topology-a', kind: 'topology' },
      { id: 'topology-b', kind: 'topology' },
      { id: 'network', kind: 'icmp' },
    ],
    widgets: [
      { id: 'existing', sectionId: 'topology-a', type: 'availability', mapX: 0, mapY: 0 },
      { id: 'keep-position', sectionId: 'topology-a', type: 'availability', mapX: 184, mapY: 92 },
      { id: 'new', sectionId: 'topology-a', type: 'availability', mapX: null, mapY: null },
      { id: 'other-map', sectionId: 'topology-b', type: 'availability', mapX: null, mapY: null },
      { id: 'not-a-map', sectionId: 'network', type: 'metric', mapX: null, mapY: null },
    ],
  }

  const resolved = resolveLayoutMapPositions(layout)

  assert.deepEqual(
    resolved.map(({ id, mapX, mapY }) => ({ id, mapX, mapY })),
    [
      { id: 'existing', mapX: 0, mapY: 0 },
      { id: 'keep-position', mapX: 184, mapY: 92 },
      { id: 'new', mapX: 92, mapY: 0 },
      { id: 'other-map', mapX: 0, mapY: 0 },
      { id: 'not-a-map', mapX: null, mapY: null },
    ],
  )
  assert.equal(layout.widgets[2].mapX, null)
  assert.deepEqual(resolveLayoutMapPositions({ ...layout, widgets: resolved }), resolved)
})

test('resolves unsectioned topology dashboards and leaves unrelated widgets unchanged', () => {
  const layout = {
    type: 'topology',
    sections: [],
    widgets: [
      { id: 'first', type: 'availability', mapX: 0, mapY: 0 },
      { id: 'second', type: 'availability', mapX: null, mapY: null },
      { id: 'section-widget', sectionId: 'other', type: 'metric', mapX: null, mapY: null },
    ],
  }

  const resolved = resolveLayoutMapPositions(layout)

  assert.deepEqual(
    resolved.map(({ id, mapX, mapY }) => ({ id, mapX, mapY })),
    [
      { id: 'first', mapX: 0, mapY: 0 },
      { id: 'second', mapX: 92, mapY: 0 },
      { id: 'section-widget', mapX: null, mapY: null },
    ],
  )
})
