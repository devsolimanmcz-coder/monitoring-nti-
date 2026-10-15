import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertModeratorConfigUpdate } from './dashboard-permissions.js'

function baseConfig() {
  return {
    defaultDashboardId: 'operations',
    preferences: { refreshSeconds: 30 },
    alertRules: { cpuPct: 90 },
    connectivityLayout: { sections: [], hiddenIcmp: [], orderIcmp: [], assignments: {} },
    serverLayout: { sections: [], hiddenServers: [], orderServers: [], assignments: {} },
    dashboards: [{
      id: 'operations',
      title: 'Operações',
      type: 'general',
      favorite: true,
      sections: [{ id: 'network', title: 'Rede' }],
      widgets: [{ id: 'latency', title: 'Latência', itemId: 101 }],
      hiddenIcmp: [],
      hiddenServers: [],
      orderIcmp: ['router'],
      orderServers: [],
      assignments: { router: 'network' },
    }],
  }
}

test('allows moderators to add sections and widgets without removing existing ones', () => {
  const persisted = baseConfig()
  const incoming = structuredClone(persisted)
  incoming.dashboards[0].sections.push({ id: 'servers', title: 'Servidores' })
  incoming.dashboards[0].widgets.push({ id: 'cpu', title: 'CPU', itemId: 202 })

  assert.doesNotThrow(() => assertModeratorConfigUpdate(persisted, incoming))
})

test('rejects replacing an existing section with a newly added one', () => {
  const persisted = baseConfig()
  const incoming = structuredClone(persisted)
  incoming.dashboards[0].sections = [{ id: 'servers', title: 'Servidores' }]

  assert.throws(
    () => assertModeratorConfigUpdate(persisted, incoming),
    /não editar nem excluir as existentes/,
  )
})

test('rejects replacing an existing widget with a newly added one', () => {
  const persisted = baseConfig()
  const incoming = structuredClone(persisted)
  incoming.dashboards[0].widgets = [{ id: 'cpu', title: 'CPU', itemId: 202 }]

  assert.throws(
    () => assertModeratorConfigUpdate(persisted, incoming),
    /não editar nem excluir os existentes/,
  )
})

test('prevents moderators from resizing existing cards', () => {
  const persisted = baseConfig()
  const incoming = structuredClone(persisted)
  incoming.dashboards[0].cardSizes = { 'icmp:router': { width: 2, height: 3 } }

  assert.throws(
    () => assertModeratorConfigUpdate(persisted, incoming),
    /não podem redimensionar os cards existentes/,
  )
})

test('prevents moderators from removing connectivity sections or hosts', () => {
  const persisted = baseConfig()
  persisted.connectivityLayout.sections = [{ id: 'links', title: 'Links', kind: 'icmp' }]
  persisted.connectivityLayout.assignments = { router: 'links' }
  const incoming = structuredClone(persisted)
  incoming.connectivityLayout.sections = []
  incoming.connectivityLayout.assignments = {}

  assert.throws(
    () => assertModeratorConfigUpdate(persisted, incoming),
    /não editar nem excluir as existentes/,
  )
})

test('allows moderators to add server sections and rejects deleting them', () => {
  const persisted = baseConfig()
  const incoming = structuredClone(persisted)
  incoming.serverLayout.sections.push({ id: 'database', title: 'Banco de dados', kind: 'servers' })
  incoming.serverLayout.assignments.SERVER01 = 'database'
  assert.doesNotThrow(() => assertModeratorConfigUpdate(persisted, incoming))

  assert.throws(
    () => assertModeratorConfigUpdate(incoming, persisted),
    /não editar nem excluir as existentes/,
  )
})
