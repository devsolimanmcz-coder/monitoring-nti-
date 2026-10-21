import 'dotenv/config'
import express from 'express'
import mysql from 'mysql2/promise'
import {
  addUser,
  authenticateUser,
  deleteUser,
  getAuthenticatedUser,
  initializeAuthStore,
  listUsers,
  revokeSession,
  updateUser,
} from './auth.js'
import {
  CATALOG_HOSTS_QUERY,
  CATALOG_QUERY,
  ICMP_QUERY,
  ITEM_TYPE_BATCH_QUERY,
  ITEM_TYPE_QUERY,
  SERVER_DISKS_QUERY,
  SERVER_METRICS_QUERY,
  UPS_METRICS_QUERY,
  UPS_TRIGGERS_QUERY,
} from './queries.js'
import { evaluateAlerts } from './alert-engine.js'
import {
  mergeDashboardConfig,
  readDashboardConfig,
  updateDashboardConfig,
} from './dashboard-config.js'
import { assertModeratorConfigUpdate } from './dashboard-permissions.js'
import {
  closeApplicationDatabase,
  getApplicationDatabase,
  initializeApplicationDatabase,
} from './app-database.js'

const app = express()
app.use(express.json({ limit: '1mb' }))
const port = Number(process.env.API_PORT || 3001)
const host = process.env.API_HOST || '127.0.0.1'
const SESSION_COOKIE = 'nti_pulse_session'
const HISTORY_RANGES = new Map([
  ['15m', 900],
  ['1h', 3600],
  ['3h', 10800],
  ['6h', 21600],
  ['24h', 86400],
  ['7d', 604800],
  ['30d', 2592000],
])

let pool

function readSessionToken(request) {
  const cookies = request.headers.cookie || ''
  for (const cookie of cookies.split(';')) {
    const [name, ...value] = cookie.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('='))
  }
  return ''
}

function setSessionCookie(response, token) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  })
}

function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  })
}

function requireAuth(request, response, next) {
  const user = getAuthenticatedUser(readSessionToken(request))
  if (!user) {
    response.status(401).json({ error: 'Entre na sua conta para continuar.' })
    return
  }
  request.authUser = user
  request.authToken = readSessionToken(request)
  next()
}

function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.authUser?.role)) {
      response.status(403).json({ error: 'Seu grupo não tem permissão para esta ação.' })
      return
    }
    next()
  }
}

function filteredConfigForUser(config, user) {
  if (user.role !== 'view') return config
  const dashboards = config.dashboards.filter((item) => user.dashboardIds.includes(item.id))
  if (!dashboards.length) return null
  return {
    ...config,
    dashboards,
    activeDashboardId: dashboards.some((item) => item.id === config.activeDashboardId)
      ? config.activeDashboardId
      : dashboards[0].id,
    defaultDashboardId: dashboards.some((item) => item.id === config.defaultDashboardId)
      ? config.defaultDashboardId
      : dashboards[0].id,
  }
}

async function userCanReadHistoryItems(user, itemIds) {
  if (user.role !== 'view') return true
  const config = await readDashboardConfig()
  const permittedIds = new Set(config.dashboards
    .filter((dashboard) => user.dashboardIds.includes(dashboard.id))
    .flatMap((dashboard) => dashboard.widgets.flatMap((widget) => widget.itemIds || [widget.itemId]))
    .map(Number))
  return itemIds.every((itemId) => permittedIds.has(itemId))
}

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

app.post('/api/auth/login', async (request, response) => {
  try {
    const session = await authenticateUser(request.body?.username, request.body?.password, request.ip)
    setSessionCookie(response, session.token)
    response.json({ user: session.user, expiresIn: session.expiresIn })
  } catch (error) {
    response.status(error.code ? 500 : 401).json({ error: error.message })
  }
})

app.get('/api/auth/me', requireAuth, (request, response) => {
  response.json({ user: request.authUser })
})

app.post('/api/auth/logout', async (request, response) => {
  try {
    await revokeSession(readSessionToken(request))
  } catch (error) {
    console.error('Falha ao encerrar sessão no armazenamento:', error.message)
    clearSessionCookie(response)
    response.status(500).json({ error: 'Não foi possível encerrar a sessão no servidor.' })
    return
  }
  clearSessionCookie(response)
  response.status(204).end()
})

app.get('/api/users', requireAuth, requireRole('administrator'), (_request, response) => {
  response.json(listUsers())
})

app.post('/api/users', requireAuth, requireRole('administrator'), async (request, response) => {
  try {
    const config = await readDashboardConfig()
    const validDashboardIds = new Set(config.dashboards.map((item) => item.id))
    response.status(201).json(await addUser(request.body || {}, validDashboardIds))
  } catch (error) {
    response.status(error.code ? 500 : 400).json({ error: error.message || 'Não foi possível criar o usuário.' })
  }
})

app.patch('/api/users/:userId', requireAuth, requireRole('administrator'), async (request, response) => {
  try {
    const config = await readDashboardConfig()
    const validDashboardIds = new Set(config.dashboards.map((item) => item.id))
    response.json(await updateUser(request.params.userId, {
      ...request.body,
      requesterId: request.authUser.id,
    }, validDashboardIds))
  } catch (error) {
    response.status(error.code ? 500 : 400).json({ error: error.message || 'Não foi possível atualizar o usuário.' })
  }
})

app.delete('/api/users/:userId', requireAuth, requireRole('administrator'), async (request, response) => {
  try {
    await deleteUser(request.params.userId, request.authUser.id)
    response.status(204).end()
  } catch (error) {
    response.status(error.code ? 500 : 400).json({ error: error.message || 'Não foi possível excluir o usuário.' })
  }
})

app.get('/api/health', async (_request, response) => {
  const checks = await Promise.allSettled([
    Promise.resolve().then(() => getPool().query('SELECT 1')),
    Promise.resolve().then(() => getApplicationDatabase().query('SELECT 1')),
  ])
  const [zabbixCheck, applicationCheck] = checks
  if (zabbixCheck.status === 'rejected') {
    console.error('Health check do banco Zabbix falhou:', zabbixCheck.reason.message)
  }
  if (applicationCheck.status === 'rejected') {
    console.error('Health check do banco da aplicação falhou:', applicationCheck.reason.message)
  }
  const zabbixDatabase = zabbixCheck.status === 'fulfilled' ? 'connected' : 'unavailable'
  const applicationDatabase = applicationCheck.status === 'fulfilled' ? 'connected' : 'unavailable'
  const errors = []
  if (zabbixCheck.status === 'rejected') {
    errors.push(zabbixCheck.reason.message.startsWith('Configuração ausente')
      ? zabbixCheck.reason.message
      : 'Não foi possível conectar ao banco do Zabbix; confira as configurações DB_*.')
  }
  if (applicationCheck.status === 'rejected') {
    errors.push(applicationCheck.reason.message.startsWith('Configuração ausente')
      ? applicationCheck.reason.message
      : 'Não foi possível conectar ao banco da aplicação; confira as configurações APP_DB_*.')
  }
  const status = errors.length ? 'error' : 'ok'
  response.status(errors.length ? 503 : 200).json({
    status,
    zabbixDatabase,
    applicationDatabase,
    ...(errors.length ? { errors } : {}),
  })
})

app.get('/api/dashboard-config', requireAuth, async (request, response) => {
  try {
    const config = filteredConfigForUser(await readDashboardConfig(), request.authUser)
    if (!config) {
      response.status(403).json({ error: 'Nenhum painel está atribuído à sua conta. Peça ao administrador que atribua um painel.' })
      return
    }
    response.json(config)
  } catch (error) {
    console.error('Leitura da configuração do dashboard falhou:', error.message)
    response.status(500).json({ error: 'Não foi possível ler a configuração do painel.' })
  }
})

app.put('/api/dashboard-config', requireAuth, requireRole('administrator', 'moderator'), async (request, response) => {
  try {
    const { baseConfig, ...incomingConfig } = request.body || {}
    if (!baseConfig) {
      const error = new Error('Esta tela está com uma versão antiga da configuração. Recarregue o painel antes de salvar.')
      error.statusCode = 428
      throw error
    }
    response.json(await updateDashboardConfig((persisted) => {
      const merged = mergeDashboardConfig(persisted, incomingConfig, baseConfig)
      if (request.authUser.role === 'moderator') assertModeratorConfigUpdate(persisted, merged)
      return merged
    }))
  } catch (error) {
    console.error('Salvamento da configuração do dashboard falhou:', error.message)
    response.status(error.statusCode || (error.code ? 500 : 400)).json({
      error: error.code
        ? 'Não foi possível salvar a configuração do painel no banco da aplicação.'
        : error.message || 'Não foi possível salvar a configuração do painel.',
    })
  }
})

app.get('/api/catalog', requireAuth, requireRole('administrator', 'moderator'), async (request, response) => {
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

app.get('/api/catalog/hosts', requireAuth, requireRole('administrator', 'moderator'), async (_request, response) => {
  try {
    const [rows] = await getPool().query(CATALOG_HOSTS_QUERY)
    response.json(rows.map((row) => ({ hostId: Number(row.hostid), hostName: row.host })))
  } catch (error) {
    console.error('Consulta de equipamentos do catálogo falhou:', error.message)
    response.status(503).json({ error: 'Não foi possível consultar a lista de equipamentos do Zabbix.' })
  }
})

app.get('/api/history', requireAuth, async (request, response) => {
  const rawIds = typeof request.query.itemIds === 'string' ? request.query.itemIds : ''
  const itemIds = [...new Set(rawIds.split(',').map(Number))]
  const range = typeof request.query.range === 'string' ? request.query.range : '1h'
  const seconds = HISTORY_RANGES.get(range)
  if (!rawIds || itemIds.length > 100 || itemIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || !seconds) {
    response.status(400).json({ error: 'Lista de itens ou intervalo de histórico inválido.' })
    return
  }

  try {
    if (!await userCanReadHistoryItems(request.authUser, itemIds)) {
      response.status(403).json({ error: 'Esse histórico não pertence aos painéis atribuídos à sua conta.' })
      return
    }
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
      const bucketSeconds = Math.max(1, Math.floor(seconds / 300))
      const recentSamples = tableIds.map(() => (
        `(SELECT itemid, bucket * ${bucketSeconds} AS clock, average_value AS value FROM (
          SELECT itemid, bucket, AVG(value) AS average_value FROM (
            SELECT itemid, FLOOR(clock / ${bucketSeconds}) AS bucket, value
            FROM ${table}
            WHERE itemid = ? AND clock >= UNIX_TIMESTAMP() - ?
          ) AS samples
          GROUP BY itemid, bucket
          ORDER BY bucket DESC
          LIMIT 300
        ) AS bucket_averages)`
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

app.get('/api/history/:itemId', requireAuth, async (request, response) => {
  const itemId = Number(request.params.itemId)
  const range = typeof request.query.range === 'string' ? request.query.range : '1h'
  const seconds = HISTORY_RANGES.get(range)
  if (!Number.isSafeInteger(itemId) || itemId <= 0 || !seconds) {
    response.status(400).json({ error: 'Item ou intervalo de histórico inválido.' })
    return
  }

  try {
    if (!await userCanReadHistoryItems(request.authUser, [itemId])) {
      response.status(403).json({ error: 'Esse histórico não pertence aos painéis atribuídos à sua conta.' })
      return
    }
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

app.get('/api/alerts', requireAuth, requireRole('administrator', 'moderator'), async (_request, response) => {
  try {
    const config = await readDashboardConfig()
    response.json({ alerts: config.alerts, events: config.alertEvents, rules: config.alertRules })
  } catch (error) {
    console.error('Leitura dos alertas falhou:', error.message)
    response.status(500).json({ error: 'Não foi possível ler os alertas.' })
  }
})

app.post('/api/alerts/:alertId/acknowledge', requireAuth, requireRole('administrator', 'moderator'), async (request, response) => {
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

app.get('/api/dashboard', requireAuth, async (request, response) => {
  try {
    const database = getPool()
    const [icmpRows, serverRows, diskRows, upsRows, upsTriggerRows] = await Promise.all([
      database.query(ICMP_QUERY).then(([rows]) => rows),
      database.query(SERVER_METRICS_QUERY).then(([rows]) => rows),
      database.query(SERVER_DISKS_QUERY).then(([rows]) => rows),
      database.query(UPS_METRICS_QUERY).then(([rows]) => rows),
      database.query(UPS_TRIGGERS_QUERY).then(([rows]) => rows),
    ])

    const upsTriggersByHost = new Map()
    for (const row of upsTriggerRows) {
      const triggers = upsTriggersByHost.get(row.host_name) || []
      triggers.push({
        id: String(row.triggerid),
        description: row.description,
        priority: Number(row.priority),
        startedAt: row.lastchange
          ? new Date(Number(row.lastchange) * 1000).toISOString()
          : null,
      })
      upsTriggersByHost.set(row.host_name, triggers)
    }

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
        status_text: row.status_text,
        last_metric_at: row.last_metric_clock
          ? new Date(Number(row.last_metric_clock) * 1000).toISOString()
          : null,
        cpu_pct: toNullableNumber(row.cpu_pct),
        ram_pct: toNullableNumber(row.ram_pct),
        ram_used_gib: toNullableNumber(row.ram_used_gib),
        ram_total_gib: toNullableNumber(row.ram_total_gib),
        disks: disksByHost.get(row.host_name) || [],
      })),
      ups: upsRows.map((row) => {
        const pingClock = row.ping_clock ? Number(row.ping_clock) : null
        const pingValue = toNullableNumber(row.ping_value)
        const triggers = upsTriggersByHost.get(row.host_name) || []
        const stalePing = pingValue === null || !pingClock || Math.floor(Date.now() / 1000) - pingClock > 180
        return {
          host_name: row.host_name,
          status_text: stalePing
            ? 'SEM DADOS'
            : pingValue === 0
              ? 'OFFLINE'
              : triggers.length
                ? 'ALERTA'
                : 'ONLINE',
          battery_pct: toNullableNumber(row.battery_pct),
          load_pct: toNullableNumber(row.load_pct),
          output_source: toNullableNumber(row.output_source),
          runtime_minutes: toNullableNumber(row.runtime_minutes),
          temperature_c: toNullableNumber(row.temperature_c),
          battery_status: toNullableNumber(row.battery_status),
          last_metric_at: row.last_metric_clock
            ? new Date(Number(row.last_metric_clock) * 1000).toISOString()
            : null,
          triggers,
        }
      }),
    }
    let savedConfig
    try {
      savedConfig = await updateDashboardConfig((config) => evaluateAlerts(config, dashboard))
    } catch (error) {
      console.error('Persistência dos alertas no banco da aplicação falhou:', error.message)
      response.status(503).json({ error: 'Falha ao salvar o estado dos alertas no banco da aplicação.' })
      return
    }
    const responseDashboard = {
      ...dashboard,
      alerts: savedConfig.alerts,
      alertEvents: savedConfig.alertEvents,
      preferences: savedConfig.preferences,
    }
    if (request.authUser.role === 'view') {
      const config = filteredConfigForUser(savedConfig, request.authUser)
      if (!config) {
        response.status(403).json({ error: 'Nenhum painel está atribuído à sua conta.' })
        return
      }
      const permittedKinds = new Set(config.dashboards.flatMap((item) => item.sections.map((section) => section.kind)))
      const permittedHosts = new Set(config.dashboards.flatMap((item) => item.widgets.flatMap((widget) => [
        widget.hostName,
        ...(widget.items || []).map((metric) => metric.hostName),
      ]).filter(Boolean)))
      responseDashboard.icmp = permittedKinds.has('icmp') ? responseDashboard.icmp : []
      responseDashboard.servers = permittedKinds.has('servers') ? responseDashboard.servers : []
      responseDashboard.ups = []
      const visibleAlerts = responseDashboard.alerts.filter((alert) => (
        ['host_unavailable', 'collection_stale', 'high_latency', 'packet_loss'].includes(alert.type)
          ? permittedKinds.has('icmp') || permittedHosts.has(alert.hostName)
          : ['high_cpu', 'high_memory', 'disk_usage'].includes(alert.type)
            && (permittedKinds.has('servers') || permittedHosts.has(alert.hostName))
      ))
      const visibleAlertIds = new Set(visibleAlerts.map((alert) => alert.id))
      responseDashboard.alerts = visibleAlerts
      responseDashboard.alertEvents = responseDashboard.alertEvents.filter((event) => visibleAlertIds.has(event.alertId))
    }
    response.json(responseDashboard)
  } catch (error) {
    console.error('Consulta do dashboard falhou:', error.message)
    response.status(503).json({
      error: error.message.startsWith('Configuração ausente')
        ? error.message
        : 'Falha ao consultar o banco Zabbix. Verifique a conexão e os privilégios SELECT.',
    })
  }
})

await initializeApplicationDatabase()
await initializeAuthStore()
await readDashboardConfig()

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
    await closeApplicationDatabase()
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
