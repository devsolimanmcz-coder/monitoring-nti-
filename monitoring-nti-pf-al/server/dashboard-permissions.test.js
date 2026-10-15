import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertModeratorConfigUpdate } from './dashboard-permissions.js'

function baseConfig() {
  return {
    defaultDashboardId: 'operations',
    preferences: { refreshSeconds: 30 },
    alertRules: { cpuPct: 90 },
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
