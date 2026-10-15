import 'dotenv/config'
import express from 'express'
import mysql from 'mysql2/promise'
import {
  CATALOG_HOSTS_QUERY,
  CATALOG_QUERY,
  ICMP_QUERY,
  ITEM_TYPE_BATCH_QUERY,
  ITEM_TYPE_QUERY,
  SERVER_DISKS_QUERY,
  SERVER_METRICS_QUERY,
} from './queries.js'
import { evaluateAlerts } from './alert-engine.js'
import {
  readDashboardConfig,
  updateDashboardConfig,
} from './dashboard-config.js'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const host = process.env.API_HOST || '127.0.0.1'
const HISTORY_RANGES = new Map([
  ['15m', 900],
  ['1h', 3600],
  ['6h', 21600],
  ['24h', 86400],
  ['7d', 604800],
])

let pool

function getPool() {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
  const missing = required.filter((key) => !process.env[key])

  if (missing.length) {
    throw new Error(`Configuração ausente no .env: ${missing.join(', ')}`)
  }

  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
      maxIdle: 2,
      idleTimeout: 60_000,
      queueLimit: 20,
      enableKeepAlive: true,
      decimalNumbers: true,
    })
  }

  return pool
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

app.get('/api/health', async (_request, response) => {
  try {
    await getPool().query('SELECT 1')
    response.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    console.error('Health check do banco falhou:', error.message)
    response.status(503).json({
      status: 'error',
      database: 'unavailable',
      error: error.message.startsWith('Configuração ausente')
        ? error.message
        : 'Não foi possível conectar ao banco de monitoramento.',
    })
  }
})

app.get('/api/dashboard-config', async (_request, response) => {
  try {
    response.json(await readDashboardConfig())
  } catch (error) {
    console.error('Leitura da configuração do dashboard falhou:', error.message)
    response.status(500).json({ error: 'Não foi possível ler a configuração do painel.' })
  }
})

app.put('/api/dashboard-config', express.json({ limit: '1mb' }), async (request, response) => {
  try {
    response.json(await updateDashboardConfig((persisted) => ({
      ...request.body,
      alerts: persisted.alerts,
      alertEvents: persisted.alertEvents,
      conditions: persisted.conditions,
    })))
  } catch (error) {
    console.error('Salvamento da configuração do dashboard falhou:', error.message)
    response.status(error.code ? 500 : 400).json({
      error: error.code
        ? 'Não foi possível salvar a configuração do painel no armazenamento local.'
        : error.message || 'Não foi possível salvar a configuração do painel.',
    })
  }
})

app.get('/api/catalog', async (request, response) => {
  try {
    const hostIdValue = request.query.hostId
    const hostId = hostIdValue === undefined ? 0 : Number(hostIdValue)
    if (!Number.isSafeInteger(hostId) || hostId < 0) {
      response.status(400).json({ error: 'Equipamento inválido para consultar o catálogo.' })
      return
    }
    const pageValue = request.query.page === undefined ? 0 : Number(request.query.page)
    if (!Number.isSafeInteger(pageValue) || pageValue < 0 || pageValue > 100_000) {
      response.status(400).json({ error: 'Página do catálogo inválida.' })
      return
    }
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : ''
    const pattern = search ? `%${search}%` : ''
    const [rows] = await getPool().execute(CATALOG_QUERY, [
      hostId, hostId, search, pattern, pattern, pageValue * 100,
    ])
    response.json(rows.map((row) => ({
      itemId: Number(row.itemid),
      hostId: Number(row.hostid),
      hostName: row.host,
      itemName: row.item_name,
      key: row.key_,
      valueType: Number(row.value_type),
      unit: row.units || '',
    })))
  } catch (error) {
    console.error('Consulta do catálogo de métricas falhou:', error.message)
    response.status(503).json({ error: 'Não foi possível consultar os equipamentos e itens numéricos do Zabbix.' })
  }
})

app.get('/api/catalog/hosts', async (_request, response) => {
  try {
    const [rows] = await getPool().query(CATALOG_HOSTS_QUERY)
    response.json(rows.map((row) => ({ hostId: Number(row.hostid), hostName: row.host })))
  } catch (error) {
    console.error('Consulta de equipamentos do catálogo falhou:', error.message)
    response.status(503).json({ error: 'Não foi possível consultar a lista de equipamentos do Zabbix.' })
  }
})

app.get('/api/history', async (request, response) => {
  const rawIds = typeof request.query.itemIds === 'string' ? request.query.itemIds : ''
  const itemIds = [...new Set(rawIds.split(',').map(Number))]
  const range = typeof request.query.range === 'string' ? request.query.range : '1h'
  const seconds = HISTORY_RANGES.get(range)
  if (!rawIds || itemIds.length > 100 || itemIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || !seconds) {
    response.status(400).json({ error: 'Lista de itens ou intervalo de histórico inválido.' })
    return
  }

  try {
    const database = getPool()
    const placeholders = itemIds.map(() => '?').join(',')
    const metadataQuery = ITEM_TYPE_BATCH_QUERY.replace('%s', placeholders)
    const [items] = await database.execute(metadataQuery, itemIds)
    const result = Object.fromEntries(items.map((item) => [Number(item.itemid), {
      item: {
        itemId: Number(item.itemid),
        hostName: item.host_name,
        itemName: item.item_name,
        unit: item.units || '',
      },
      range,
      points: [],
    }]))

    for (const [valueType, table] of [[0, 'history'], [3, 'history_uint']]) {
      const tableIds = items.filter((item) => Number(item.value_type) === valueType).map((item) => Number(item.itemid))
      if (!tableIds.length) continue
      const recentSamples = tableIds.map(() => (
        `(SELECT itemid, clock, value FROM ${table} WHERE itemid = ? AND clock >= UNIX_TIMESTAMP() - ? ORDER BY clock DESC LIMIT 300)`
      )).join(' UNION ALL ')
      const [rows] = await database.execute(
        `SELECT itemid, clock, value FROM (${recentSamples}) AS recent ORDER BY itemid, clock`,
        tableIds.flatMap((itemId) => [itemId, seconds]),
      )
      for (const row of rows) {
        const metric = result[Number(row.itemid)]
        metric.points.push({
          time: new Date(Number(row.clock) * 1000).toISOString(),
          value: toNullableNumber(row.value),
        })
      }
    }

    response.json(result)
  } catch (error) {
    console.error('Consulta em lote do histórico falhou:', error.message)
    response.status(503).json({ error: 'Não foi possível consultar o histórico dos itens no Zabbix.' })
  }
})

app.get('/api/history/:itemId', async (request, response) => {
  const itemId = Number(request.params.itemId)
  const range = typeof request.query.range === 'string' ? request.query.range : '1h'
  const seconds = HISTORY_RANGES.get(range)
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || !seconds) {
    response.status(400).json({ error: 'Item ou intervalo de histórico inválido.' })
    return
  }

  try {
    const database = getPool()
    const [items] = await database.execute(ITEM_TYPE_QUERY, [itemId])
    if (!items.length) {
      response.status(404).json({ error: 'Item numérico ativo não encontrado.' })
      return
    }
    const table = Number(items[0].value_type) === 3 ? 'history_uint' : 'history'
    const [rows] = await database.execute(
      `SELECT clock, value FROM ${table} WHERE itemid = ? AND clock >= UNIX_TIMESTAMP() - ? ORDER BY clock DESC LIMIT 1000`,
      [itemId, seconds],
    )
    response.json({
      item: {
        itemId,
        hostName: items[0].host_name,
        itemName: items[0].item_name,
        unit: items[0].units || '',
      },
      range,
      points: rows.reverse().map((row) => ({
        time: new Date(Number(row.clock) * 1000).toISOString(),
        value: toNullableNumber(row.value),
      })),
    })
  } catch (error) {
    console.error('Consulta de histórico falhou:', error.message)
    response.status(503).json({ error: 'Não foi possível consultar o histórico do item no Zabbix.' })
  }
})

app.get('/api/alerts', async (_request, response) => {
  try {
    const config = await readDashboardConfig()
    response.json({ alerts: config.alerts, events: config.alertEvents, rules: config.alertRules })
  } catch (error) {
    console.error('Leitura dos alertas falhou:', error.message)
    response.status(500).json({ error: 'Não foi possível ler os alertas.' })
  }
})

app.post('/api/alerts/:alertId/acknowledge', express.json({ limit: '16kb' }), async (request, response) => {
  try {
    let result
    await updateDashboardConfig((config) => {
      const alert = config.alerts.find((candidate) => candidate.id === request.params.alertId)
      if (!alert) {
        const error = new Error('Alerta não encontrado.')
        error.statusCode = 404
        throw error
      }
      if (alert.status === 'active') {
        alert.status = 'acknowledged'
        alert.acknowledgedAt = new Date().toISOString()
        config.alertEvents.push({
          id: `${Date.now()}-${alert.id}`,
          alertId: alert.id,
          action: 'acknowledged',
          message: 'Alerta reconhecido pelo operador.',
          at: alert.acknowledgedAt,
        })
      }
      result = alert
      return config
    })
    response.json({ alert: result })
  } catch (error) {
    console.error('Reconhecimento do alerta falhou:', error.message)
    response.status(error.statusCode || 500).json({ error: error.statusCode === 404 ? error.message : 'Não foi possível reconhecer o alerta.' })
  }
})

app.get('/api/dashboard', async (_request, response) => {
  try {
    const database = getPool()
    const [icmpRows, serverRows, diskRows] = await Promise.all([
      database.query(ICMP_QUERY).then(([rows]) => rows),
      database.query(SERVER_METRICS_QUERY).then(([rows]) => rows),
      database.query(SERVER_DISKS_QUERY).then(([rows]) => rows),
    ])

    const disksByHost = new Map()
    for (const row of diskRows) {
      const disks = disksByHost.get(row.host_name) || []
      disks.push({
        drive: row.drive,
        used_pct: toNullableNumber(row.used_pct),
        used_gib: toNullableNumber(row.used_gib),
        total_gib: toNullableNumber(row.total_gib),
      })
      disksByHost.set(row.host_name, disks)
    }

    const dashboard = {
      updatedAt: new Date().toISOString(),
      icmp: icmpRows.map((row) => ({
        ...row,
        icmp_ms: toNullableNumber(row.icmp_ms),
        ping_value: toNullableNumber(row.ping_value),
        icmp_loss: toNullableNumber(row.icmp_loss),
        default_section_id: row.section_id,
      })),
      servers: serverRows.map((row) => ({
        host_name: row.host_name,
        cpu_pct: toNullableNumber(row.cpu_pct),
        ram_pct: toNullableNumber(row.ram_pct),
        ram_used_gib: toNullableNumber(row.ram_used_gib),
        ram_total_gib: toNullableNumber(row.ram_total_gib),
        disks: disksByHost.get(row.host_name) || [],
      })),
    }
    const savedConfig = await updateDashboardConfig((config) => evaluateAlerts(config, dashboard))
    response.json({
      ...dashboard,
      alerts: savedConfig.alerts,
      alertEvents: savedConfig.alertEvents,
      preferences: savedConfig.preferences,
    })
  } catch (error) {
    console.error('Consulta do dashboard falhou:', error.message)
    response.status(503).json({
      error: error.message.startsWith('Configuração ausente')
        ? error.message
        : 'Falha ao consultar o banco Zabbix. Verifique a conexão e os privilégios SELECT.',
    })
  }
})

const server = app.listen(port, host, () => {
  console.log(`API de monitoramento disponível em http://${host}:${port}`)
})

async function shutdown(signal) {
  console.log(`${signal} recebido; encerrando API...`)
  server.close(async (error) => {
    if (error) {
      console.error('Falha ao encerrar o servidor HTTP:', error)
      process.exitCode = 1
    }
    if (pool) await pool.end()
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
