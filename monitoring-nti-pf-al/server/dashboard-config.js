import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getApplicationDatabase, initializeApplicationDatabase } from './app-database.js'

const dataDirectory = path.resolve(process.env.APP_DATA_DIR || 'data')
const legacyConfigPath = path.join(dataDirectory, 'dashboard.json')
let updateQueue = Promise.resolve()

const defaultSections = [
  { id: 'network', title: 'INFRAESTRUTURA - ATIVOS DE REDE', kind: 'icmp' },
  { id: 'applications', title: 'APLICAÇÕES PRINCIPAIS PF', kind: 'icmp' },
  { id: 'servers', title: 'INFRAESTRUTURA - SERVIDORES', kind: 'servers' },
]

const defaultDashboard = () => ({
  id: 'main',
  title: 'Monitoramento de infraestrutura',
  favorite: true,
  sections: defaultSections.map((section) => ({ ...section })),
  hiddenIcmp: [],
  hiddenServers: [],
  orderIcmp: [],
  orderServers: [],
  assignments: {},
  cardSizes: {},
  widgets: [],
})

const defaultConnectivityLayout = () => ({
  sections: [],
  hiddenIcmp: [],
  orderIcmp: [],
  assignments: {},
  cardSizes: {},
})

const defaultServerLayout = () => ({
  sections: [],
  hiddenServers: [],
  orderServers: [],
  assignments: {},
  cardSizes: {},
})

export const DEFAULT_DASHBOARD_CONFIG = {
  dashboards: [defaultDashboard()],
  connectivityLayout: defaultConnectivityLayout(),
  serverLayout: defaultServerLayout(),
  activeDashboardId: 'main',
  defaultDashboardId: 'main',
  preferences: {
    autoRefresh: true,
    refreshSeconds: 30,
    theme: 'dark',
    kiosk: { rotationEnabled: false, secondsPerDashboard: 30, dashboardIds: [] },
  },
  alertRules: {
    minDurationSeconds: 60,
    recurrenceSeconds: 300,
    diskWarningPct: 80,
    diskCriticalPct: 90,
    packetLossPct: 1,
    latencyWarningMs: 100,
    latencyCriticalMs: 250,
    cpuPct: 90,
    memoryPct: 90,
    staleSeconds: 180,
  },
  alerts: [],
  alertEvents: [],
  conditions: {},
}

const allowedKinds = new Set(['icmp', 'servers', 'consumption', 'ups'])
const allowedWidgets = new Set(['metric', 'timeseries', 'availability', 'gauge', 'table', 'icmp', 'server', 'alerts', 'camera', 'ups'])

function normalizeWidgetGeometry(widget) {
  const mapSizePx = Number(widget.mapSizePx ?? 80)
  const mapCols = Number(widget.mapCols ?? 4)
  const mapRows = Number(widget.mapRows ?? 4)
  const mapX = widget.mapX == null ? null : Number(widget.mapX)
  const mapY = widget.mapY == null ? null : Number(widget.mapY)
  if (!Number.isInteger(mapSizePx) || mapSizePx < 56 || mapSizePx > 480) {
    throw new Error('O tamanho do host deve estar entre 56 e 480 pixels.')
  }
  if (!Number.isInteger(mapCols) || mapCols < 2 || mapCols > 24
    || !Number.isInteger(mapRows) || mapRows < 2 || mapRows > 24) {
    throw new Error('O tamanho do gráfico deve estar entre 2 e 24 colunas e 2 e 24 linhas.')
  }
  if ((mapX === null) !== (mapY === null)
    || (mapX !== null && (!Number.isSafeInteger(mapX) || mapX < 0 || mapX > 1000000))
    || (mapY !== null && (!Number.isSafeInteger(mapY) || mapY < 0 || mapY > 1000000))) {
    throw new Error('A posição do indicador no mapa deve usar coordenadas em pixels válidas.')
  }
  return {
    width: [1, 2, 3, 4].includes(Number(widget.width)) ? Number(widget.width) : 1,
    height: Number.isInteger(Number(widget.height)) && Number(widget.height) >= 1 && Number(widget.height) <= 8
      ? Number(widget.height)
      : widget.type === 'ups' ? 3 : widget.type === 'timeseries' ? 2 : 1,
    mapSizePx,
    mapCols,
    mapRows,
    mapX,
    mapY,
  }
}

function normalizeCameraUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw new Error('Informe um endereço de câmera válido de até 2048 caracteres.')
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Informe um endereço de câmera HTTP ou HTTPS válido.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('O endereço da câmera deve usar HTTP ou HTTPS e não pode conter credenciais.')
  }
  return url.href
}

function normalizeCardSizes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([key, size]) => key.length <= 264
      && size
      && Number.isInteger(Number(size.width))
      && Number(size.width) >= 1
      && Number(size.width) <= 4
      && Number.isInteger(Number(size.height))
      && Number(size.height) >= 1
      && Number(size.height) <= 8)
    .slice(0, 1000)
    .map(([key, size]) => [key, { width: Number(size.width), height: Number(size.height) }]))
}

function normalizeDashboard(dashboard) {
  if (!dashboard || !Array.isArray(dashboard.sections) || !Array.isArray(dashboard.widgets)) {
    throw new Error('Formato inválido para um painel.')
  }
  if (typeof dashboard.title !== 'string' || !dashboard.title.trim()) {
    throw new Error('Cada painel precisa ter um nome.')
  }
  const sectionIds = new Set()
  const sections = dashboard.sections.map((section) => {
    const id = typeof section.id === 'string' ? section.id.trim() : ''
    const title = typeof section.title === 'string' ? section.title.trim() : ''
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !title || title.length > 100 || !allowedKinds.has(section.kind)) {
      throw new Error('Seção inválida. Confira o identificador, nome e tipo.')
    }
    if (sectionIds.has(id)) throw new Error('Os identificadores das seções devem ser únicos.')
    sectionIds.add(id)
    return { id, title, kind: section.kind }
  })

  const widgets = dashboard.widgets.map((widget) => {
    if (!widget || typeof widget.id !== 'string' || !allowedWidgets.has(widget.type)) {
      throw new Error('Indicador inválido.')
    }
    if (typeof widget.title !== 'string' || !widget.title.trim() || widget.title.length > 100) {
      throw new Error('Cada indicador precisa ter um título de até 100 caracteres.')
    }
    const geometry = normalizeWidgetGeometry(widget)
    if (widget.type === 'ups') {
      const hostName = typeof widget.hostName === 'string' ? widget.hostName.trim() : ''
      const sectionId = typeof widget.sectionId === 'string' ? widget.sectionId : ''
      const section = sections.find((item) => item.id === sectionId)
      if (!hostName || hostName.length > 255) {
        throw new Error('Selecione um nobreak válido para o indicador.')
      }
      if (widget.sectionId !== undefined && (!sectionId || section?.kind !== 'consumption')) {
        throw new Error('Indicadores só podem ser associados a seções de consumo válidas.')
      }
      return {
        id: widget.id.slice(0, 80),
        title: widget.title.trim(),
        type: 'ups',
        hostName,
        ...(sectionId ? { sectionId } : {}),
        ...geometry,
      }
    }
    if (widget.type === 'camera') {
      const sectionId = typeof widget.sectionId === 'string' ? widget.sectionId : ''
      const section = sections.find((item) => item.id === sectionId)
      if (widget.sectionId !== undefined && (!sectionId || section?.kind !== 'consumption')) {
        throw new Error('Indicadores só podem ser associados a seções de consumo válidas.')
      }
      return {
        id: widget.id.slice(0, 80),
        title: widget.title.trim(),
        type: 'camera',
        ...(sectionId ? { sectionId } : {}),
        cameraUrl: normalizeCameraUrl(widget.cameraUrl),
        ...geometry,
      }
    }
    if (!Number.isInteger(Number(widget.itemId)) || Number(widget.itemId) <= 0) {
      throw new Error('Cada indicador precisa referenciar um item monitorado válido.')
    }
    const itemIds = Array.isArray(widget.itemIds) ? [...new Set(widget.itemIds.map(Number))] : [Number(widget.itemId)]
    if (
      itemIds.length < 1
      || itemIds.length > 8
      || itemIds.some((itemId) => !Number.isSafeInteger(itemId) || itemId <= 0)
      || !itemIds.includes(Number(widget.itemId))
      || (widget.type === 'availability' && itemIds.length !== 1)
    ) {
      throw new Error('Cada indicador deve ter de 1 a 8 itens válidos; disponibilidade aceita apenas um item.')
    }
    const range = widget.range || '1h'
    if (!['15m', '1h', '3h', '6h', '24h', '7d', '30d'].includes(range)) {
      throw new Error('Período de histórico inválido para o indicador.')
    }
    const itemMetadata = Array.isArray(widget.items) ? widget.items : [{
      itemId: widget.itemId,
      hostId: widget.hostId,
      hostName: widget.hostName,
      itemName: widget.itemName,
      key: widget.key,
      unit: widget.unit,
    }]
    const items = itemMetadata
      .filter((item) => itemIds.includes(Number(item.itemId)))
      .map((item) => ({
        itemId: Number(item.itemId),
        hostId: Number.isSafeInteger(Number(item.hostId)) && Number(item.hostId) > 0 ? Number(item.hostId) : null,
        hostName: typeof item.hostName === 'string' ? item.hostName.slice(0, 255) : '',
        itemName: typeof item.itemName === 'string' ? item.itemName.slice(0, 255) : '',
        key: typeof item.key === 'string' ? item.key.slice(0, 255) : '',
        unit: typeof item.unit === 'string' ? item.unit.slice(0, 40) : '',
      }))
    if (items.length !== itemIds.length) throw new Error('Metadados inválidos para os itens do indicador.')
    const sectionId = typeof widget.sectionId === 'string' ? widget.sectionId : ''
    const section = sections.find((item) => item.id === sectionId)
    if (widget.sectionId !== undefined && (!sectionId || section?.kind !== 'consumption')) {
      throw new Error('Indicadores só podem ser associados a seções de consumo válidas.')
    }
    return {
      id: widget.id.slice(0, 80),
      title: widget.title.trim(),
      type: widget.type,
      ...(sectionId ? { sectionId } : {}),
      range,
      itemId: Number(widget.itemId),
      itemIds,
      items,
      hostId: Number.isSafeInteger(Number(widget.hostId)) && Number(widget.hostId) > 0 ? Number(widget.hostId) : null,
      hostName: typeof widget.hostName === 'string' ? widget.hostName.slice(0, 255) : '',
      itemName: typeof widget.itemName === 'string' ? widget.itemName.slice(0, 255) : '',
      unit: typeof widget.unit === 'string' ? widget.unit.slice(0, 40) : '',
      ...geometry,
    }
  })

  const normalizeNames = (items, field) => {
    if (!Array.isArray(items)) throw new Error(`Campo ${field} inválido.`)
    return [...new Set(items.filter((item) => typeof item === 'string').map((item) => item.slice(0, 255)))]
  }

  const assignments = {}
  if (dashboard.assignments && typeof dashboard.assignments === 'object' && !Array.isArray(dashboard.assignments)) {
    for (const [hostName, sectionId] of Object.entries(dashboard.assignments)) {
      if (typeof sectionId === 'string' && sectionIds.has(sectionId) && hostName.length <= 255) {
        assignments[hostName] = sectionId
      }
    }
  }

  return {
    id: String(dashboard.id || '').slice(0, 80),
    title: dashboard.title.trim().replace(/^Novo dashboard (\d+)$/i, 'Novo painel $1').slice(0, 100),
    type: ['network', 'topology'].includes(dashboard.type) ? dashboard.type : 'general',
    favorite: Boolean(dashboard.favorite),
    sections,
    hiddenIcmp: normalizeNames(dashboard.hiddenIcmp, 'hiddenIcmp'),
    hiddenServers: normalizeNames(dashboard.hiddenServers, 'hiddenServers'),
    orderIcmp: normalizeNames(dashboard.orderIcmp, 'orderIcmp'),
    orderServers: normalizeNames(dashboard.orderServers, 'orderServers'),
    assignments,
    cardSizes: normalizeCardSizes(dashboard.cardSizes),
    widgets,
  }
}

function normalizeConnectivityLayout(layout = {}) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new Error('Configuração da página Conectividade inválida.')
  }
  const sectionIds = new Set()
  const sections = (Array.isArray(layout.sections) ? layout.sections : []).map((section) => {
    const id = typeof section.id === 'string' ? section.id.trim() : ''
    const title = typeof section.title === 'string' ? section.title.trim() : ''
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !title || title.length > 100) {
      throw new Error('Seção de conectividade inválida.')
    }
    if (sectionIds.has(id)) throw new Error('Os identificadores das seções de conectividade devem ser únicos.')
    sectionIds.add(id)
    return { id, title, kind: 'icmp' }
  })
  const normalizeNames = (items, field) => {
    if (!Array.isArray(items)) throw new Error(`Campo ${field} da conectividade inválido.`)
    return [...new Set(items.filter((item) => typeof item === 'string').map((item) => item.slice(0, 255)))]
  }
  const assignments = {}
  if (layout.assignments && typeof layout.assignments === 'object' && !Array.isArray(layout.assignments)) {
    for (const [hostName, sectionId] of Object.entries(layout.assignments)) {
      if (typeof sectionId === 'string' && sectionIds.has(sectionId) && hostName.length <= 255) {
        assignments[hostName] = sectionId
      }
    }
  }
  return {
    sections,
    hiddenIcmp: normalizeNames(layout.hiddenIcmp ?? [], 'hiddenIcmp'),
    orderIcmp: normalizeNames(layout.orderIcmp ?? [], 'orderIcmp'),
    assignments,
    cardSizes: normalizeCardSizes(layout.cardSizes),
  }
}

function normalizeServerLayout(layout = {}) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    throw new Error('Configuração da página Servidores inválida.')
  }
  const sectionIds = new Set()
  const sections = (Array.isArray(layout.sections) ? layout.sections : []).map((section) => {
    const id = typeof section.id === 'string' ? section.id.trim() : ''
    const title = typeof section.title === 'string' ? section.title.trim() : ''
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !title || title.length > 100) {
      throw new Error('Seção de servidores inválida.')
    }
    if (sectionIds.has(id)) throw new Error('Os identificadores das seções de servidores devem ser únicos.')
    sectionIds.add(id)
    return { id, title, kind: 'servers' }
  })
  const normalizeNames = (items, field) => {
    if (!Array.isArray(items)) throw new Error(`Campo ${field} dos servidores inválido.`)
    return [...new Set(items.filter((item) => typeof item === 'string').map((item) => item.slice(0, 255)))]
  }
  const assignments = {}
  if (layout.assignments && typeof layout.assignments === 'object' && !Array.isArray(layout.assignments)) {
    for (const [hostName, sectionId] of Object.entries(layout.assignments)) {
      if (typeof sectionId === 'string' && sectionIds.has(sectionId) && hostName.length <= 255) {
        assignments[hostName] = sectionId
      }
    }
  }
  return {
    sections,
    hiddenServers: normalizeNames(layout.hiddenServers ?? [], 'hiddenServers'),
    orderServers: normalizeNames(layout.orderServers ?? [], 'orderServers'),
    assignments,
    cardSizes: normalizeCardSizes(layout.cardSizes),
  }
}

function normalizeConfig(value) {
  if (!value || typeof value !== 'object') throw new Error('Configuração inválida.')
  const legacyDashboard = Array.isArray(value.sections)
    ? { ...defaultDashboard(), ...value, id: 'main', title: 'Monitoramento de infraestrutura', widgets: [] }
    : null
  const dashboardsInput = Array.isArray(value.dashboards) ? value.dashboards : [legacyDashboard || defaultDashboard()]
  if (dashboardsInput.length < 1) throw new Error('É necessário manter ao menos um painel.')
  const dashboards = dashboardsInput.map(normalizeDashboard)
  const ids = new Set()
  for (const dashboard of dashboards) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(dashboard.id) || ids.has(dashboard.id)) {
      throw new Error('Identificador de painel inválido ou duplicado.')
    }
    ids.add(dashboard.id)
  }

  const preferences = value.preferences || DEFAULT_DASHBOARD_CONFIG.preferences
  const kiosk = preferences.kiosk || {}
  const refreshSeconds = Number(preferences.refreshSeconds || 30)
  const secondsPerDashboard = Number(kiosk.secondsPerDashboard || 30)

  const alertRules = value.alertRules || DEFAULT_DASHBOARD_CONFIG.alertRules
  const numericRuleKeys = Object.keys(DEFAULT_DASHBOARD_CONFIG.alertRules)
  const normalizedRules = Object.fromEntries(numericRuleKeys.map((key) => {
    const number = Number(alertRules[key] ?? DEFAULT_DASHBOARD_CONFIG.alertRules[key])
    if (!Number.isFinite(number) || number < 0 || number > 86400) throw new Error(`Limite de alerta inválido: ${key}.`)
    return [key, number]
  }))
  if (normalizedRules.diskCriticalPct < normalizedRules.diskWarningPct) {
    throw new Error('O limite crítico de disco não pode ser menor que o limite de aviso.')
  }
  if (normalizedRules.latencyCriticalMs < normalizedRules.latencyWarningMs) {
    throw new Error('O limite crítico de latência não pode ser menor que o limite de aviso.')
  }

  const activeDashboardId = ids.has(value.activeDashboardId) ? value.activeDashboardId : dashboards[0].id
  const defaultDashboardId = ids.has(value.defaultDashboardId) ? value.defaultDashboardId : dashboards[0].id
  const dashboardIds = Array.isArray(kiosk.dashboardIds)
    ? [...new Set(kiosk.dashboardIds.filter((id) => ids.has(id)))]
    : []
  const alerts = Array.isArray(value.alerts) ? value.alerts.slice(0, 10000) : []
  const alertEvents = Array.isArray(value.alertEvents) ? value.alertEvents.slice(-20000) : []
  const conditions = value.conditions && typeof value.conditions === 'object' ? value.conditions : {}

  return {
    dashboards,
    connectivityLayout: normalizeConnectivityLayout(value.connectivityLayout),
    serverLayout: normalizeServerLayout(value.serverLayout),
    activeDashboardId,
    defaultDashboardId,
    preferences: {
      autoRefresh: preferences.autoRefresh !== false,
      refreshSeconds: Number.isFinite(refreshSeconds) ? Math.min(3600, Math.max(5, refreshSeconds)) : 30,
      theme: ['dark', 'light', 'high-contrast'].includes(preferences.theme) ? preferences.theme : 'dark',
      kiosk: {
        rotationEnabled: Boolean(kiosk.rotationEnabled),
        secondsPerDashboard: Number.isFinite(secondsPerDashboard)
          ? Math.min(3600, Math.max(5, secondsPerDashboard))
          : 30,
        dashboardIds,
      },
    },
    alertRules: normalizedRules,
    alerts,
    alertEvents,
    conditions,
  }
}

export async function readDashboardConfig() {
  await initializeApplicationDatabase()
  const database = getApplicationDatabase()
  const [rows] = await database.execute(
    'SELECT payload FROM app_dashboard_config WHERE config_id = 1',
  )
  if (rows.length) return normalizeConfig(JSON.parse(rows[0].payload))

  let initialConfig = structuredClone(DEFAULT_DASHBOARD_CONFIG)
  try {
    initialConfig = normalizeConfig(JSON.parse(await readFile(legacyConfigPath, 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  await database.execute(
    'INSERT IGNORE INTO app_dashboard_config (config_id, payload) VALUES (1, ?)',
    [JSON.stringify(initialConfig)],
  )
  const [importedRows] = await database.execute(
    'SELECT payload FROM app_dashboard_config WHERE config_id = 1',
  )
  return normalizeConfig(JSON.parse(importedRows[0].payload))
}

export async function saveDashboardConfig(value) {
  const normalized = normalizeConfig(value)
  await initializeApplicationDatabase()
  await getApplicationDatabase().execute(
    `INSERT INTO app_dashboard_config (config_id, payload) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [JSON.stringify(normalized)],
  )

  return normalized
}

function configsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function conflict(message) {
  const error = new Error(message)
  error.statusCode = 409
  return error
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeConfigValue(current, incoming, base, label) {
  if (configsEqual(incoming, base)) return current
  if (configsEqual(current, base) || configsEqual(current, incoming)) return incoming

  if (isRecord(current) && isRecord(incoming) && isRecord(base)) {
    const merged = { ...current }
    const keys = new Set([...Object.keys(base), ...Object.keys(incoming)])
    for (const key of keys) {
      const hasBase = Object.hasOwn(base, key)
      const hasIncoming = Object.hasOwn(incoming, key)
      const hasCurrent = Object.hasOwn(current, key)
      if (!hasIncoming) {
        if (hasBase && hasCurrent && !configsEqual(current[key], base[key])) {
          throw conflict(`A configuração "${label}.${key}" foi alterada em outra tela.`)
        }
        delete merged[key]
        continue
      }
      if (!hasBase) {
        if (hasCurrent && !configsEqual(current[key], incoming[key])) {
          throw conflict(`A configuração "${label}.${key}" foi criada em outra tela.`)
        }
        merged[key] = incoming[key]
        continue
      }
      if (!hasCurrent) {
        if (!configsEqual(incoming[key], base[key])) {
          throw conflict(`A configuração "${label}.${key}" foi removida em outra tela.`)
        }
        delete merged[key]
        continue
      }
      merged[key] = mergeConfigValue(current[key], incoming[key], base[key], `${label}.${key}`)
    }
    return merged
  }

  if (Array.isArray(current) && Array.isArray(incoming) && Array.isArray(base)
    && [...current, ...incoming, ...base].every((item) => isRecord(item) && typeof item.id === 'string')) {
    const currentById = new Map(current.map((item) => [item.id, item]))
    const incomingById = new Map(incoming.map((item) => [item.id, item]))
    const baseById = new Map(base.map((item) => [item.id, item]))
    const mergedById = new Map(currentById)
    for (const [id, baseItem] of baseById) {
      const incomingItem = incomingById.get(id)
      const currentItem = currentById.get(id)
      if (!incomingItem) {
        if (currentItem && !configsEqual(currentItem, baseItem)) {
          throw conflict(`"${label}" foi alterado em outra tela e não pode ser removido com dados desatualizados.`)
        }
        mergedById.delete(id)
        continue
      }
      if (!currentItem) {
        if (!configsEqual(incomingItem, baseItem)) {
          throw conflict(`"${label}" foi removido em outra tela antes de ser atualizado.`)
        }
        continue
      }
      mergedById.set(id, mergeConfigValue(currentItem, incomingItem, baseItem, `${label}.${id}`))
    }
    for (const [id, incomingItem] of incomingById) {
      if (baseById.has(id)) continue
      const currentItem = currentById.get(id)
      if (currentItem && !configsEqual(currentItem, incomingItem)) {
        mergedById.set(id, mergeConfigValue(currentItem, incomingItem, {}, `${label}.${id}`))
      } else {
        mergedById.set(id, incomingItem)
      }
    }
    const orderedIds = [...incoming.map((item) => item.id), ...current.map((item) => item.id)]
    const seenIds = new Set()
    return orderedIds
      .filter((id) => !seenIds.has(id) && seenIds.add(id))
      .map((id) => mergedById.get(id))
      .filter(Boolean)
  }

  throw conflict(`A configuração "${label}" foi alterada em outra tela. Recarregue antes de salvar novamente.`)
}

export function mergeDashboardConfig(currentValue, incomingValue, baseValue) {
  const current = normalizeConfig(currentValue)
  const incoming = normalizeConfig(incomingValue)
  if (!baseValue) throw conflict('A tela não enviou a versão base da configuração. Recarregue o painel antes de salvar.')
  const base = normalizeConfig(baseValue)

  const merged = { ...current }
  for (const key of Object.keys(current)) {
    if (['dashboards', 'alerts', 'alertEvents', 'conditions', 'activeDashboardId'].includes(key)) continue
    merged[key] = mergeConfigValue(current[key], incoming[key], base[key], key)
  }

  if (!configsEqual(incoming.activeDashboardId, base.activeDashboardId)) {
    merged.activeDashboardId = incoming.activeDashboardId
  }

  merged.dashboards = mergeConfigValue(current.dashboards, incoming.dashboards, base.dashboards, 'painéis')
  merged.alerts = current.alerts
  merged.alertEvents = current.alertEvents
  merged.conditions = current.conditions
  return normalizeConfig(merged)
}

export function updateDashboardConfig(updater) {
  const operation = updateQueue.then(async () => {
    await initializeApplicationDatabase()
    const database = getApplicationDatabase()
    const connection = await database.getConnection()
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute(
        'SELECT payload FROM app_dashboard_config WHERE config_id = 1 FOR UPDATE',
      )
      if (!rows.length) {
        await connection.execute(
          'INSERT INTO app_dashboard_config (config_id, payload) VALUES (1, ?)',
          [JSON.stringify(DEFAULT_DASHBOARD_CONFIG)],
        )
      }
      const [currentRows] = rows.length
        ? [rows]
        : await connection.execute(
          'SELECT payload FROM app_dashboard_config WHERE config_id = 1 FOR UPDATE',
        )
      const current = normalizeConfig(JSON.parse(currentRows[0].payload))
      const updated = normalizeConfig(await updater(current))
      if (!configsEqual(updated, current)) {
        await connection.execute(
          'UPDATE app_dashboard_config SET payload = ? WHERE config_id = 1',
          [JSON.stringify(updated)],
        )
      }
      await connection.commit()
      return updated
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  })
  updateQueue = operation.catch(() => undefined)
  return operation
}
