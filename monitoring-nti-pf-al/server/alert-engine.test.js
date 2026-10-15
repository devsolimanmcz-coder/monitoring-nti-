import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DASHBOARD_CONFIG } from './dashboard-config.js'
import { evaluateAlerts } from './alert-engine.js'

function createConfig(overrides = {}) {
  return {
    ...structuredClone(DEFAULT_DASHBOARD_CONFIG),
    alertRules: {
      ...DEFAULT_DASHBOARD_CONFIG.alertRules,
      minDurationSeconds: 0,
      ...overrides,
    },
  }
}

test('opens one alert after the condition persists and resolves it on recovery', () => {
  const config = createConfig({ minDurationSeconds: 60 })
  const snapshot = { icmp: [{ host_name: 'LINK-01', status_text: 'OFFLINE' }], servers: [] }

  evaluateAlerts(config, snapshot, 100_000)
  assert.equal(config.alerts.length, 0)

  evaluateAlerts(config, snapshot, 161_000)
  assert.equal(config.alerts.length, 1)
  assert.equal(config.alerts[0].status, 'active')
  assert.equal(config.alertEvents.length, 1)

  evaluateAlerts(config, snapshot, 191_000)
  assert.equal(config.alerts.length, 1)

  evaluateAlerts(config, { icmp: [{ host_name: 'LINK-01', status_text: 'ONLINE' }], servers: [] }, 200_000)
  assert.equal(config.alerts[0].status, 'resolved')
  assert.equal(config.alertEvents.at(-1).action, 'resolved')
})

test('keeps acknowledgement separate from recovery and detects resource thresholds', () => {
  const config = createConfig()
  const snapshot = {
    icmp: [],
    servers: [{
      host_name: 'SRV-01',
      cpu_pct: 96,
      ram_pct: 95,
      disks: [{ drive: 'C:', used_pct: 91 }],
    }],
  }

  evaluateAlerts(config, snapshot, 500_000)
  assert.equal(config.alerts.length, 3)
  assert.ok(config.alerts.every((alert) => alert.severity === 'critical'))

  config.alerts[0].status = 'acknowledged'
  config.alerts[0].acknowledgedAt = new Date(501_000).toISOString()
  evaluateAlerts(config, snapshot, 502_000)
  assert.equal(config.alerts[0].status, 'acknowledged')

  evaluateAlerts(config, { icmp: [], servers: [] }, 503_000)
  assert.ok(config.alerts.every((alert) => alert.status === 'resolved'))
})
