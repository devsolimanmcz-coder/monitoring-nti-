import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'monitoring-dashboard-config-'))
process.env.APP_DATA_DIR = temporaryDirectory
const { DEFAULT_DASHBOARD_CONFIG, readDashboardConfig, saveDashboardConfig } = await import('./dashboard-config.js')

after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

function configWithWidget(widget) {
  const config = structuredClone(DEFAULT_DASHBOARD_CONFIG)
  config.dashboards[0].widgets = [{
    id: 'graph-test',
    title: 'Tráfego de rede',
    type: 'timeseries',
    range: '1h',
    itemId: 123,
    itemIds: [123],
    items: [{ itemId: 123, hostId: 456, hostName: 'Roteador', itemName: 'Bytes recebidos', key: 'net.if.in[eth0]', unit: 'bps' }],
    hostId: 456,
    hostName: 'Roteador',
    itemName: 'Bytes recebidos',
    unit: 'bps',
    ...widget,
  }]
  return config
}

test('persists map pixel positions and expanded chart dimensions with item keys', async () => {
  await saveDashboardConfig(configWithWidget({ mapSizePx: 112, mapCols: 18, mapRows: 20, mapX: 347, mapY: 219 }))

  const savedWidget = (await readDashboardConfig()).dashboards[0].widgets[0]
  assert.equal(savedWidget.mapSizePx, 112)
  assert.equal(savedWidget.mapCols, 18)
  assert.equal(savedWidget.mapRows, 20)
  assert.equal(savedWidget.mapX, 347)
  assert.equal(savedWidget.mapY, 219)
  assert.equal(savedWidget.items[0].key, 'net.if.in[eth0]')
})

test('rejects out-of-range map sizes', async () => {
  await assert.rejects(
    saveDashboardConfig(configWithWidget({ mapSizePx: 500 })),
    /tamanho do host deve estar entre 56 e 480 pixels/,
  )
})

test('rejects incomplete or negative pixel positions', async () => {
  await assert.rejects(saveDashboardConfig(configWithWidget({ mapX: 20 })), /coordenadas em pixels válidas/)
  await assert.rejects(saveDashboardConfig(configWithWidget({ mapX: -1, mapY: 20 })), /coordenadas em pixels válidas/)
})

test('starts connectivity without sections and persists manually configured sections', async () => {
  const config = structuredClone(DEFAULT_DASHBOARD_CONFIG)
  assert.deepEqual(config.connectivityLayout.sections, [])

  config.connectivityLayout.sections = [{ id: 'links-core', title: 'Links principais', kind: 'icmp' }]
  config.connectivityLayout.assignments = { ROUTER: 'links-core', UNKNOWN: 'not-a-section' }
  const saved = await saveDashboardConfig(config)

  assert.deepEqual(saved.connectivityLayout.sections, [{ id: 'links-core', title: 'Links principais', kind: 'icmp' }])
  assert.deepEqual(saved.connectivityLayout.assignments, { ROUTER: 'links-core' })
})

test('starts servers without sections and persists manually configured sections', async () => {
  const config = structuredClone(DEFAULT_DASHBOARD_CONFIG)
  assert.deepEqual(config.serverLayout.sections, [])

  config.serverLayout.sections = [{ id: 'database-servers', title: 'Servidores de banco', kind: 'servers' }]
  config.serverLayout.assignments = { SERVER01: 'database-servers' }
  const saved = await saveDashboardConfig(config)

  assert.deepEqual(saved.serverLayout.sections, [{ id: 'database-servers', title: 'Servidores de banco', kind: 'servers' }])
  assert.deepEqual(saved.serverLayout.assignments, { SERVER01: 'database-servers' })
})
