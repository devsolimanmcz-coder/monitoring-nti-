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
  widgets: [],
})

export const DEFAULT_DASHBOARD_CONFIG = {
  dashboards: [defaultDashboard()],
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

const allowedKinds = new Set(['icmp', 'servers'])
const allowedWidgets = new Set(['metric', 'timeseries', 'availability', 'gauge', 'table', 'icmp', 'server', 'alerts'])

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
    if (!['15m', '1h', '6h', '24h', '7d'].includes(range)) {
      throw new Error('Período de histórico inválido para o indicador.')
    }
    const itemMetadata = Array.isArray(widget.items) ? widget.items : [{
      itemId: widget.itemId,
      hostId: widget.hostId,
      hostName: widget.hostName,
      itemName: widget.itemName,
      unit: widget.unit,
    }]
    const items = itemMetadata
      .filter((item) => itemIds.includes(Number(item.itemId)))
      .map((item) => ({
        itemId: Number(item.itemId),
        hostId: Number.isSafeInteger(Number(item.hostId)) && Number(item.hostId) > 0 ? Number(item.hostId) : null,
        hostName: typeof item.hostName === 'string' ? item.hostName.slice(0, 255) : '',
        itemName: typeof item.itemName === 'string' ? item.itemName.slice(0, 255) : '',
        unit: typeof item.unit === 'string' ? item.unit.slice(0, 40) : '',
      }))
    if (items.length !== itemIds.length) throw new Error('Metadados inválidos para os itens do indicador.')
    return {
      id: widget.id.slice(0, 80),
      title: widget.title.trim(),
      type: widget.type,
      range,
      itemId: Number(widget.itemId),
      itemIds,
      items,
      hostId: Number.isSafeInteger(Number(widget.hostId)) && Number(widget.hostId) > 0 ? Number(widget.hostId) : null,
      hostName: typeof widget.hostName === 'string' ? widget.hostName.slice(0, 255) : '',
      itemName: typeof widget.itemName === 'string' ? widget.itemName.slice(0, 255) : '',
      unit: typeof widget.unit === 'string' ? widget.unit.slice(0, 40) : '',
      width: [1, 2, 3, 4].includes(Number(widget.width)) ? Number(widget.width) : 1,
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
    widgets,
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
