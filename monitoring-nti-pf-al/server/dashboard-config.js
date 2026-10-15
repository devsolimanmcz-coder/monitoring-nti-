import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const dataDirectory = path.resolve(process.env.APP_DATA_DIR || 'data')
const configPath = path.join(dataDirectory, 'dashboard.json')
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

const allowedKinds = new Set(['icmp', 'servers', 'consumption'])
const allowedWidgets = new Set(['metric', 'timeseries', 'availability', 'gauge', 'table', 'icmp', 'server', 'alerts'])

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
      width: [1, 2, 3, 4].includes(Number(widget.width)) ? Number(widget.width) : 1,
      height: Number.isInteger(Number(widget.height)) && Number(widget.height) >= 1 && Number(widget.height) <= 8
        ? Number(widget.height)
        : widget.type === 'timeseries' ? 2 : 1,
      mapSizePx,
      mapCols,
      mapRows,
      mapX,
      mapY,
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
  try {
    const content = await readFile(configPath, 'utf8')
    return normalizeConfig(JSON.parse(content))
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(DEFAULT_DASHBOARD_CONFIG)
    throw error
  }
}

export async function saveDashboardConfig(value) {
  const normalized = normalizeConfig(value)
  await mkdir(dataDirectory, { recursive: true })

  const tempPath = path.join(dataDirectory, `dashboard.${randomUUID()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(tempPath, configPath)

  return normalized
}

export function updateDashboardConfig(updater) {
  const operation = updateQueue.then(async () => {
    const current = await readDashboardConfig()
    return saveDashboardConfig(await updater(current))
  })
  updateQueue = operation.catch(() => undefined)
  return operation
}
