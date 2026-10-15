import { randomUUID } from 'node:crypto'

function eventFor(alert, action, message, now) {
  return {
    id: randomUUID(),
    alertId: alert.id,
    action,
    message,
    at: new Date(now).toISOString(),
  }
}

function hasMetricValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function detectConditions(snapshot, rules) {
  const conditions = []

  for (const host of snapshot.icmp || []) {
    const name = host.host_name
    if (host.status_text === 'OFFLINE') {
      conditions.push({ key: `host-offline:${name}`, hostName: name, type: 'host_unavailable', severity: 'critical', description: 'Equipamento indisponível via ICMP', value: 0, threshold: 1 })
    } else if (host.status_text === 'SEM DADOS' || host.status_text === 'PING SEM DADOS') {
      conditions.push({ key: `host-stale:${name}`, hostName: name, type: 'collection_stale', severity: 'warning', description: 'Coleta ICMP sem atualização recente', value: null, threshold: rules.staleSeconds })
    }
    if (hasMetricValue(host.icmp_ms) && Number(host.icmp_ms) >= rules.latencyWarningMs) {
      const critical = Number(host.icmp_ms) >= rules.latencyCriticalMs
      conditions.push({
        key: `latency:${name}`,
        hostName: name,
        type: 'high_latency',
        severity: critical ? 'critical' : 'warning',
        description: `Latência acima do limite: ${Number(host.icmp_ms).toFixed(2)} ms`,
        value: Number(host.icmp_ms),
        threshold: critical ? rules.latencyCriticalMs : rules.latencyWarningMs,
      })
    }
    if (hasMetricValue(host.icmp_loss) && Number(host.icmp_loss) > rules.packetLossPct) {
      conditions.push({
        key: `packet-loss:${name}`,
        hostName: name,
        type: 'packet_loss',
        severity: Number(host.icmp_loss) >= rules.packetLossPct * 3 ? 'critical' : 'warning',
        description: `Perda de pacotes acima do limite: ${Number(host.icmp_loss).toFixed(2)}%`,
        value: Number(host.icmp_loss),
        threshold: rules.packetLossPct,
      })
    }
  }

  for (const server of snapshot.servers || []) {
    for (const [metric, value, threshold] of [
      ['cpu', server.cpu_pct, rules.cpuPct],
      ['memory', server.ram_pct, rules.memoryPct],
    ]) {
      if (hasMetricValue(value) && Number(value) >= threshold) {
        conditions.push({
          key: `${metric}:${server.host_name}`,
          hostName: server.host_name,
          type: `high_${metric}`,
          severity: Number(value) >= Math.min(100, threshold + 5) ? 'critical' : 'warning',
          description: `${metric === 'cpu' ? 'CPU' : 'Memória'} acima do limite: ${Number(value).toFixed(1)}%`,
          value: Number(value),
          threshold,
        })
      }
    }
    for (const disk of server.disks || []) {
      if (hasMetricValue(disk.used_pct) && Number(disk.used_pct) >= rules.diskWarningPct) {
        const critical = Number(disk.used_pct) >= rules.diskCriticalPct
        conditions.push({
          key: `disk:${server.host_name}:${disk.drive}`,
          hostName: server.host_name,
          type: 'disk_usage',
          severity: critical ? 'critical' : 'warning',
          description: `Disco ${disk.drive} com ocupação de ${Number(disk.used_pct).toFixed(1)}%`,
          value: Number(disk.used_pct),
          threshold: critical ? rules.diskCriticalPct : rules.diskWarningPct,
        })
      }
    }
  }

  return conditions
}

export function evaluateAlerts(config, snapshot, now = Date.now()) {
  const observed = detectConditions(snapshot, config.alertRules)
  const activeKeys = new Set(observed.map((condition) => condition.key))
  const conditionStates = { ...config.conditions }
  const alerts = [...config.alerts]
  const events = [...config.alertEvents]
  const alertByKey = new Map(alerts.filter((alert) => alert.status !== 'resolved').map((alert) => [alert.key, alert]))
  const nowIso = new Date(now).toISOString()

  for (const condition of observed) {
    const firstSeen = conditionStates[condition.key] || now
    conditionStates[condition.key] = firstSeen
    const alert = alertByKey.get(condition.key)
    if (alert) {
      alert.lastOccurrence = nowIso
      alert.value = condition.value
      alert.threshold = condition.threshold
      alert.severity = condition.severity
      alert.description = condition.description
      continue
    }
    if (now - firstSeen < config.alertRules.minDurationSeconds * 1000) continue
    const mostRecentResolution = alerts
      .filter((candidate) => candidate.key === condition.key && candidate.status === 'resolved')
      .reduce((latest, candidate) => Math.max(latest, new Date(candidate.resolvedAt).getTime()), 0)
    if (mostRecentResolution && now - mostRecentResolution < config.alertRules.recurrenceSeconds * 1000) continue

    const created = {
      id: randomUUID(),
      key: condition.key,
      hostName: condition.hostName,
      type: condition.type,
      description: condition.description,
      severity: condition.severity,
      value: condition.value,
      threshold: condition.threshold,
      status: 'active',
      startedAt: new Date(firstSeen).toISOString(),
      lastOccurrence: nowIso,
      acknowledgedAt: null,
      resolvedAt: null,
    }
    alerts.push(created)
    alertByKey.set(condition.key, created)
    events.push(eventFor(created, 'opened', 'Condição anormal persistiu pelo período mínimo configurado.', now))
  }

  for (const alert of alerts) {
    if (alert.status === 'resolved' || activeKeys.has(alert.key)) continue
    alert.status = 'resolved'
    alert.resolvedAt = nowIso
    events.push(eventFor(alert, 'resolved', 'Condição normalizada automaticamente.', now))
  }

  for (const key of Object.keys(conditionStates)) {
    if (!activeKeys.has(key)) delete conditionStates[key]
  }

  config.conditions = conditionStates
  config.alerts = alerts.slice(-10000)
  config.alertEvents = events.slice(-20000)
  return config
}
