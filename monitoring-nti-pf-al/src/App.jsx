import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { formatMetricSeriesGroups } from './metric-format.js'
import { getAvailabilityStatus } from './widget-status.js'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

const EMPTY_LAYOUT = {
  sections: [
    { id: 'network', title: 'INFRAESTRUTURA - ATIVOS DE REDE', kind: 'icmp' },
    { id: 'applications', title: 'APLICAÇÕES PRINCIPAIS PF', kind: 'icmp' },
    { id: 'servers', title: 'INFRAESTRUTURA - SERVIDORES', kind: 'servers' },
  ],
  hiddenIcmp: [],
  hiddenServers: [],
  orderIcmp: [],
  orderServers: [],
  assignments: {},
  cardSizes: {},
  widgets: [],
}

const EMPTY_CONNECTIVITY_LAYOUT = {
  sections: [],
  hiddenIcmp: [],
  orderIcmp: [],
  assignments: {},
  cardSizes: {},
}

const EMPTY_SERVER_LAYOUT = {
  sections: [],
  hiddenServers: [],
  orderServers: [],
  assignments: {},
  cardSizes: {},
}

function ConfirmDialog({ title, message, confirmLabel = 'Excluir', onCancel, onConfirm, busy = false }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <section className="section-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <div className="dialog-heading">
          <div><div className="eyebrow"><span className="eyebrow-line" />CONFIRMAÇÃO</div><h2 id="confirm-dialog-title">{title}</h2></div>
        </div>
        <p className="confirm-dialog-message" id="confirm-dialog-message">{message}</p>
        <div className="dialog-actions">
          <button className="dialog-cancel" type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button className="dialog-submit confirm-dialog-submit" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Excluindo...' : confirmLabel}</button>
        </div>
      </section>
    </div>
  )
}

function getMapWidgetSize(widget) {
  if (widget.type === 'availability') {
    const size = widget.mapSizePx || 80
    return { width: size, height: size }
  }
  return {
    width: (widget.mapCols || 4) * 92 - 12,
    height: Math.max(widget.mapRows || 4, 4) * 92 - 12,
  }
}

function resolveMapPositions(widgets) {
  const placed = []
  const hasCollision = (x, y, size, other) => {
    const otherSize = getMapWidgetSize(other)
    return x < other.mapX + otherSize.width
      && x + size.width > other.mapX
      && y < other.mapY + otherSize.height
      && y + size.height > other.mapY
  }

  for (const widget of widgets) {
    const size = getMapWidgetSize(widget)
    if (Number.isSafeInteger(widget.mapX) && Number.isSafeInteger(widget.mapY)) {
      placed.push({ ...widget, ...size })
      continue
    }
    let x = 0
    let y = 0
    let found = false
    while (!found) {
      const maxColumns = Math.max(1, Math.floor((1104 - size.width) / 92) + 1)
      for (let column = 0; column < maxColumns; column += 1) {
        const candidateX = column * 92
        if (!placed.some((other) => hasCollision(candidateX, y, size, other))) {
          x = candidateX
          found = true
          break
        }
      }
      if (!found) y += 92
    }
    placed.push({ ...widget, ...size, mapX: x, mapY: y })
  }
  return placed
}

function orderVisible(items, order = [], hidden = []) {
  const positions = new Map(order.map((name, index) => [name, index]))
  return items
    .filter((item) => !hidden.includes(item.host_name))
    .sort((a, b) => {
      const aPosition = positions.get(a.host_name)
      const bPosition = positions.get(b.host_name)
      if (aPosition === undefined && bPosition === undefined) return 0
      if (aPosition === undefined) return 1
      if (bPosition === undefined) return -1
      return aPosition - bPosition
    })
}

function Icon({ name, size = 18, ...props }) {
  const paths = {
    activity: <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></>,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    server: <><rect x="3" y="3" width="18" height="8" rx="2" /><rect x="3" y="13" width="18" height="8" rx="2" /><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" /></>,
    network: <><circle cx="12" cy="5" r="3" /><circle cx="5" cy="19" r="3" /><circle cx="19" cy="19" r="3" /><path d="m10.5 7.5-4 9m7-9 4 9M8 19h8" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 17 5l3 2M4 17l3 2a7 7 0 0 0 11.4-4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
    cpu: <><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 9h6v6H9zM9 1v4m6-4v4m-6 14v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4" /></>,
    memory: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10v4m4-4v4m4-4v4M7 3v3m5-3v3m5-3v3m-10 12v3m5-3v3m5-3v3" /></>,
    disk: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    grip: <><circle cx="9" cy="5" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="19" r="1" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number(value))
}

function MetricCard({ label, value, suffix, detail, icon, tone }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-topline">
        <span>{label}</span>
        <span className="metric-icon"><Icon name={icon} size={17} /></span>
      </div>
      <div className="metric-value">{value}<small>{suffix}</small></div>
      <div className="metric-detail">{detail}</div>
    </article>
  )
}

function StatusBadge({ status }) {
  const tone = status === 'ONLINE' ? 'online' : status === 'ALERTA' ? 'warning' : status === 'OFFLINE' ? 'offline' : 'unknown'
  const icon = tone === 'online' ? 'check' : tone === 'unknown' ? 'clock' : 'alert'
  const label = { ONLINE: 'DISPONÍVEL', OFFLINE: 'INDISPONÍVEL', ALERTA: 'ALERTA', 'SEM DADOS': 'SEM DADOS', 'PING SEM DADOS': 'PING SEM DADOS' }[status] || status || 'SEM DADOS'
  return <span className={`status-badge ${tone}`}><Icon name={icon} size={12} />{label}</span>
}

function alertEventLabel(action) {
  return { opened: 'Alerta aberto', resolved: 'Alerta resolvido', acknowledged: 'Alerta reconhecido' }[action] || action
}

function IcmpCard({ host, editMode, canDelete, onRemove, onDragStart, onDragOver, onDrop, size, onResize }) {
  return (
    <article
      className={`icmp-card grid-resizable-card card-width-${size?.width || 1} ${editMode ? 'card-editable' : ''}`}
      style={{ '--card-width': size?.width || 1, '--card-height': size?.height || 1 }}
      draggable={editMode}
      onDragStart={(event) => onDragStart(event, 'icmp', host.host_name)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, 'icmp', host.host_name)}
    >
      {editMode && canDelete && <button className="card-remove" type="button" aria-label={`Remover ${host.host_name}`} onClick={() => onRemove('icmp', host.host_name)}><Icon name="close" size={13} /></button>}
      {editMode && canDelete && <button className="widget-resize-handle card-resize-handle" type="button" onPointerDown={(event) => onResize(event, 'icmp', host.host_name)} aria-label={`Arraste para redimensionar ${host.host_name}`} title="Arraste para redimensionar"><Icon name="grip" size={14} /></button>}
      <div className="icmp-card-header">
        <div className="host-mark"><Icon name="network" size={17} /></div>
        <div className="host-heading">
          <h3 title={host.host_name}>{host.host_name}</h3>
          <span>Protocolo ICMP</span>
        </div>
        <StatusBadge status={host.status_text} />
      </div>

      <div className="latency-block">
        <span className="latency-value">{formatNumber(host.icmp_ms, 2)}<small>ms</small></span>
        <span className="latency-label">LATÊNCIA</span>
      </div>

      <div className="card-divider" />

      <div className="icmp-card-footer">
        <span>Perda de pacotes</span>
        <strong className={Number(host.icmp_loss) > 0 ? 'loss-warning' : ''}>
          {formatNumber(host.icmp_loss, 2)}<small>%</small>
        </strong>
      </div>
    </article>
  )
}

function ResourceBar({ label, value, detail, color }) {
  const percentage = Number(value)
  const valid = Number.isFinite(percentage)
  const width = valid ? Math.max(0, Math.min(100, percentage)) : 0

  return (
    <div className="resource-row">
      <div className="resource-label">
        <span>{label}</span>
        <strong>{valid ? `${formatNumber(percentage)}%` : 'N/D'}</strong>
      </div>
      <div className="resource-track" role="meter" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={valid ? width : 0}>
        <span className={`resource-fill ${color}`} style={{ width: `${width}%` }} />
      </div>
      {detail && <span className="resource-detail">{detail}</span>}
    </div>
  )
}

function ServerCard({ server, editMode, canDelete, onRemove, onDragStart, onDragOver, onDrop, size, onResize }) {
  return (
    <article
      className={`server-card grid-resizable-card card-width-${size?.width || 1} ${editMode ? 'card-editable' : ''}`}
      style={{ '--card-width': size?.width || 1, '--card-height': size?.height || 3 }}
      draggable={editMode}
      onDragStart={(event) => onDragStart(event, 'servers', server.host_name)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, 'servers', server.host_name)}
    >
      {editMode && canDelete && <button className="card-remove" type="button" aria-label={`Remover ${server.host_name}`} onClick={() => onRemove('servers', server.host_name)}><Icon name="close" size={13} /></button>}
      {editMode && canDelete && <button className="widget-resize-handle card-resize-handle" type="button" onPointerDown={(event) => onResize(event, 'servers', server.host_name)} aria-label={`Arraste para redimensionar ${server.host_name}`} title="Arraste para redimensionar"><Icon name="grip" size={14} /></button>}
      <div className="server-header">
        <div className="server-mark"><Icon name="server" size={18} /></div>
        <div className="server-heading">
          <h3 title={server.host_name}>{server.host_name}</h3>
          <span>Servidor Windows</span>
        </div>
        <span className="server-live-dot" title="Dados disponíveis" />
      </div>

      <div className="server-resources">
        <ResourceBar label="CPU" value={server.cpu_pct} color="cpu-fill" />
        <ResourceBar
          label="MEMÓRIA RAM"
          value={server.ram_pct}
          detail={server.ram_used_gib !== null && server.ram_total_gib !== null
            ? `${formatNumber(server.ram_used_gib)} / ${formatNumber(server.ram_total_gib)} GiB utilizados`
            : 'Memória indisponível'}
          color="ram-fill"
        />
      </div>

      <div className="disk-section">
        <div className="disk-heading"><span>ARMAZENAMENTO</span><span>Por volume</span></div>
        {server.disks.length > 0 ? (
          <div className="disk-list">
            {server.disks.map((disk) => (
              <div className="disk-row" key={`${server.host_name}-${disk.drive}`}>
                <div className="disk-row-heading"><strong>{disk.drive}</strong><b>{disk.used_pct === null ? 'N/D' : `${formatNumber(disk.used_pct)}%`}</b></div>
                <div className="resource-track disk-track" role="meter" aria-label={`Disco ${disk.drive}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={disk.used_pct === null ? 0 : Math.max(0, Math.min(100, Number(disk.used_pct)))}>
                  <span className="resource-fill disk-fill" style={{ width: `${disk.used_pct === null ? 0 : Math.max(0, Math.min(100, Number(disk.used_pct)))}%` }} />
                </div>
                <span className="disk-detail">
                  {disk.used_gib !== null && disk.total_gib !== null
                    ? `${formatNumber(disk.used_gib)} / ${formatNumber(disk.total_gib)} GiB utilizados`
                    : 'Capacidade indisponível'}
                </span>
              </div>
            ))}
          </div>
        ) : <p className="empty-inline">Sem dados de volumes</p>}
      </div>
    </article>
  )
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name="activity" size={20} /></div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function HostPicker({ hosts, onAdd }) {
  const [selected, setSelected] = useState('')

  if (!hosts.length) return <span className="layout-saved-note">Todos os equipamentos compatíveis já foram adicionados ao painel</span>

  return (
    <div className="host-picker">
      <select aria-label="Selecionar equipamento para adicionar" value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Selecionar equipamento...</option>
        {hosts.map((host) => <option key={host.host_name} value={host.host_name}>{host.host_name}</option>)}
      </select>
      <button type="button" disabled={!selected} onClick={() => { onAdd(selected); setSelected('') }}>
        <Icon name="plus" size={14} /> Adicionar
      </button>
    </div>
  )
}

function SectionDialog({ dialog, onClose, onSave }) {
  const [title, setTitle] = useState(dialog.title || '')
  const [kind, setKind] = useState(dialog.kind || 'icmp')

  function handleSubmit(event) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    onSave({ ...dialog, title: cleanTitle, kind })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="section-dialog" role="dialog" aria-modal="true" aria-labelledby="section-dialog-title" onSubmit={handleSubmit}>
        <div className="dialog-heading">
          <div><span className="eyebrow">ORGANIZAÇÃO DO PAINEL</span><h2 id="section-dialog-title">{dialog.mode === 'create' ? 'Criar seção' : 'Renomear seção'}</h2></div>
          <button className="dialog-close" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" size={17} /></button>
        </div>
        <label className="dialog-field"><span>Nome da seção</span><input autoFocus maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: INFRAESTRUTURA - ATIVOS DE REDE" required /></label>
        {dialog.mode === 'create' && !dialog.fixedKind && (
          <label className="dialog-field"><span>Tipo de cards</span>
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="icmp">Rede e aplicações (ICMP)</option>
              <option value="servers">Servidores (CPU, RAM e discos)</option>
              <option value="consumption">Consumo de dados e tráfego</option>
            </select>
          </label>
        )}
        <div className="dialog-actions">
          <button className="dialog-cancel" type="button" onClick={onClose}>Cancelar</button>
          <button className="dialog-submit" type="submit">{dialog.mode === 'create' ? 'Criar seção' : 'Salvar nome'}</button>
        </div>
      </form>
    </div>
  )
}

function MetricWidget({ widget, data }) {
  const itemIds = widget.itemIds || [widget.itemId]
  const range = widget.range || '1h'
  const rawSeries = itemIds.map((itemId) => {
    const seriesData = data[`${range}:${itemId}`] || data[itemId]
    const history = seriesData?.history
    const points = history?.points || []
    const validPoints = points.filter((point) => point.value !== null && point.value !== undefined && Number.isFinite(Number(point.value)))
    const values = validPoints.map((point) => Number(point.value))
    return {
      itemId,
      itemName: seriesData?.history?.item?.itemName
        || widget.items?.find((item) => item.itemId === itemId)?.itemName
        || widget.itemName,
      originalUnit: seriesData?.history?.item?.unit || widget.items?.find((item) => item.itemId === itemId)?.unit || widget.unit || '',
      points,
      validPoints,
      rawValues: values,
      error: seriesData?.error || '',
    }
  })
  const formattedSeries = formatMetricSeriesGroups(rawSeries)
  const series = formattedSeries.series
  const unitByAxis = new Map(formattedSeries.axes.map((axis) => [axis.id, axis.unit]))
  const displayed = formattedSeries.axes[0] || { unit: widget.unit }
  const primary = series[0]
  const points = primary?.points || []
  const displayValues = primary?.values || []
  const latest = displayValues.length ? displayValues[displayValues.length - 1] : null
  const allValues = series.flatMap((item) => item.values)
  const min = allValues.length ? Math.min(...allValues) : 0
  const max = allValues.length ? Math.max(...allValues) : 0
  const status = widget.type === 'availability'
    ? getAvailabilityStatus(points)
    : null
  const colors = ['#67a8fa', '#f2b85c', '#b49aff', '#6fd5b0', '#ff7f87', '#6ed3d8', '#d1a5ff', '#a5d67a']
  const error = series.find((item) => item.error)?.error
  const chartTimes = [...new Set(series.flatMap((item) => item.validPoints.map((point) => Date.parse(point.time)).filter(Number.isFinite)))].sort((a, b) => a - b)
  const chartData = {
    labels: chartTimes.map((time) => new Date(time).toISOString()),
    datasets: series.map((item, index) => {
      const valuesByTime = new Map(item.validPoints.map((point, pointIndex) => [Date.parse(point.time), item.values[pointIndex]]))
      return {
        label: item.itemName,
        data: chartTimes.map((time) => valuesByTime.get(time) ?? null),
        yAxisID: item.axisId,
        borderColor: colors[index % colors.length],
        backgroundColor: `${colors[index % colors.length]}22`,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.32,
        spanGaps: series.length > 1,
        fill: series.length === 1,
      }
    }),
  }
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 220 },
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0b1421',
        borderColor: 'rgba(139,164,198,.24)',
        borderWidth: 1,
        titleColor: '#e6edf7',
        bodyColor: '#c5d3e5',
        padding: 10,
        callbacks: {
          title: (items) => {
            const timestamp = Date.parse(items[0]?.label || '')
            return Number.isFinite(timestamp)
              ? new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }).format(timestamp)
              : ''
          },
          label: (item) => `${item.dataset.label}: ${formatNumber(item.parsed.y, 2)} ${unitByAxis.get(item.dataset.yAxisID) || ''}`.trim(),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          display: false,
        },
      },
      ...Object.fromEntries(formattedSeries.axes.map((axis, index) => [axis.id, {
        type: 'linear',
        position: index % 2 === 0 ? 'left' : 'right',
        weight: formattedSeries.axes.length - index,
        border: { display: false },
        grid: {
          drawOnChartArea: index === 0,
          color: 'rgba(139,164,198,.1)',
        },
        ticks: {
          color: '#8291a6',
          maxTicksLimit: 5,
          callback: (value) => `${formatNumber(value, 1)} ${axis.unit || ''}`.trim(),
        },
      }])),
    },
  }

  return (
    <article className={`custom-widget ${widget.type === 'timeseries' ? 'timeseries-widget' : ''} ${status ? `availability-widget availability-${status.state}` : ''} ${widget.dashboardType === 'topology' ? 'topology-widget' : ''}`}>
      {(widget.dashboardType !== 'topology' || widget.type === 'timeseries') && <div className={`custom-widget-heading ${widget.dashboardType === 'topology' ? 'topology-chart-heading' : ''}`}>
        <div>{widget.type === 'timeseries' ? <><h3 title={widget.hostName}>{widget.hostName}</h3><span title={widget.title}>{widget.title}</span></> : <><span title={widget.hostName}>{widget.hostName}</span><h3 title={widget.title}>{widget.title}</h3></>}</div>
        <span className="widget-unit">{status ? 'ZABBIX' : formattedSeries.axes.length > 1 ? 'múltiplas unidades' : displayed.unit || 'valor'}</span>
      </div>}
      {status ? (
        widget.dashboardType === 'topology' ? (
          <div className="topology-host-node" role="status" aria-label={`${widget.hostName}: ${status.label}`} title={`${widget.hostName} · ${status.label}`}>
            <span className="topology-host-icon"><Icon name="monitor" size={25} /></span>
            <strong title={widget.hostName}>{widget.hostName}</strong>
            <small>{status.state === 'up' ? 'OK' : status.state === 'down' ? 'HOST INDISPONÍVEL' : status.label}</small>
          </div>
        ) : (
          <div className="availability-state" role="status" aria-label={`${widget.hostName}: ${status.label}`}>
            <span className="availability-light" />
            <strong>{status.label}</strong>
            <small>{status.state === 'down' ? '1 = UP · 0 = DOWN' : status.state === 'recovering' ? 'Aguardando 30 segundos estáveis' : status.state === 'flapping' ? '3 ou mais mudanças nos últimos 5 minutos' : '1 = UP · 0 = DOWN'}</small>
          </div>
        )
      ) : (
        <>
          {widget.type === 'timeseries' ? (
            <>
              {latest !== null && <div className="timeseries-current-value">{formatNumber(latest, 2)} <small>{primary?.unit}</small></div>}
              <div className="widget-chart-container" role="img" aria-label={`Histórico de ${widget.title}`}>
                {chartTimes.length
                  ? <Line data={chartData} options={chartOptions} />
                  : <span className="widget-chart-empty">Aguardando dados do Zabbix...</span>}
              </div>
            </>
          ) : (
            <>
              <strong className="custom-widget-value">{latest === null ? '—' : formatNumber(latest, 2)}<small>{primary?.unit}</small></strong>
              <div className="widget-range"><span>Mínimo: {formatNumber(min, 2)}</span><span>Máximo: {formatNumber(max, 2)}</span></div>
            </>
          )}
          {widget.type === 'timeseries' && series.length > 1 && <div className="widget-legend">{series.map((item, index) => <span key={item.itemId}><i style={{ background: colors[index % colors.length] }} />{item.itemName} ({item.unit})</span>)}</div>}
        </>
      )}
      {error && <div className="custom-widget-foot"><span className="widget-error">{error}</span></div>}
    </article>
  )
}

function WidgetDialog({ onClose, onSave, widget, dashboardType, sectionId }) {
  const [hosts, setHosts] = useState([])
  const [catalog, setCatalog] = useState([])
  const [selectedItemDetails, setSelectedItemDetails] = useState(widget?.items || [])
  const [hostId, setHostId] = useState(widget?.hostId ? String(widget.hostId) : '')
  const [itemId, setItemId] = useState(widget ? String(widget.itemId) : '')
  const [itemPickerValue, setItemPickerValue] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState(widget?.itemIds || (widget ? [widget.itemId] : []))
  const [range, setRange] = useState(widget?.range || '1h')
  const [mapSizePx, setMapSizePx] = useState(widget?.mapSizePx || 80)
  const [title, setTitle] = useState(widget?.title || '')
  const [type, setType] = useState(widget?.type || (sectionId ? 'timeseries' : ['network', 'topology'].includes(dashboardType) ? 'availability' : 'timeseries'))
  const [search, setSearch] = useState('')
  const [itemPage, setItemPage] = useState(0)
  const [hasMoreItems, setHasMoreItems] = useState(false)
  const [hostsLoading, setHostsLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [error, setError] = useState('')
  const [itemError, setItemError] = useState('')
  const existingItems = widget?.items || (widget ? [{
    itemId: widget.itemId,
    hostId: widget.hostId,
    hostName: widget.hostName,
    itemName: widget.itemName,
    unit: widget.unit,
  }] : [])
  const availableItems = [...new Map([...existingItems, ...selectedItemDetails, ...catalog].map((item) => [Number(item.itemId), item])).values()]
  const selectedItems = selectedItemIds.map((id) => availableItems.find((item) => Number(item.itemId) === Number(id))).filter(Boolean)
  const selected = catalog.find((item) => String(item.itemId) === itemId)
    || availableItems.find((item) => String(item.itemId) === itemId)

  const toggleItem = (item) => {
    setSelectedItemDetails((current) => [...new Map([...current, item].map((entry) => [Number(entry.itemId), entry])).values()])
    setSelectedItemIds((current) => {
      if (current.includes(item.itemId)) {
        const next = current.filter((id) => id !== item.itemId)
        setItemId(String(next[0] || ''))
        return next
      }
      if (current.length >= (type === 'timeseries' ? 8 : 1)) return current
      const next = [...current, item.itemId]
      setItemId(String(next[0]))
      return next
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/catalog/hosts', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os equipamentos.')
        setHosts(payload)
        if (widget?.hostName) {
          const matchingHost = payload.find((host) => String(host.hostId) === String(widget.hostId))
            || payload.find((host) => host.hostName === widget.hostName)
          if (matchingHost) setHostId(String(matchingHost.hostId))
        }
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          console.error('Falha ao carregar os equipamentos do catálogo:', requestError)
          setError(requestError.message === 'Failed to fetch'
            ? 'Não foi possível conectar à lista de equipamentos do Zabbix.'
            : requestError.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHostsLoading(false)
      })
    return () => controller.abort()
  }, [widget?.hostId, widget?.hostName])

  useEffect(() => {
    if (!hostId) return undefined
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setItemsLoading(true)
      setItemError('')
      try {
        const params = new URLSearchParams({ hostId, search, page: String(itemPage) })
        const response = await fetch(`/api/catalog?${params}`, { signal: controller.signal })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os itens do equipamento.')
        setCatalog((current) => itemPage === 0 ? payload : [...current, ...payload])
        setSelectedItemDetails((current) => [...new Map([...current, ...payload].map((item) => [Number(item.itemId), item])).values()])
        setHasMoreItems(payload.length === 100)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          console.error('Falha ao carregar os itens do equipamento:', requestError)
          setItemError(requestError.message === 'Failed to fetch'
            ? 'Não foi possível conectar ao catálogo de itens do Zabbix.'
            : requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) setItemsLoading(false)
      }
    }, 200)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [hostId, search, itemPage])

  function submit(event) {
    event.preventDefault()
    if (!selected) return
    const items = type === 'timeseries' ? selectedItems : [selected]
    if (!items.length || (type === 'timeseries' && selectedItemIds.length !== items.length)) return
    onSave({
      id: widget?.id || crypto.randomUUID(),
      title: title.trim() || selected.itemName,
      type,
      ...((widget?.sectionId || sectionId) ? { sectionId: widget?.sectionId || sectionId } : {}),
      itemId: selected.itemId,
      itemIds: items.map((item) => item.itemId),
      items,
      range,
      mapSizePx,
      mapCols: widget?.mapCols || 4,
      mapRows: widget?.mapRows || 4,
      hostId: selected.hostId,
      hostName: selected.hostName,
      itemName: selected.itemName,
      unit: selected.unit,
      width: widget?.width || (type === 'timeseries' ? 2 : 1),
      height: widget?.height || (type === 'timeseries' ? 2 : 1),
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className={`section-dialog widget-dialog ${type === 'timeseries' ? 'timeseries-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="widget-dialog-title" onSubmit={submit}>
        <div className="dialog-heading"><div><span className="eyebrow">MÉTRICAS NUMÉRICAS DO ZABBIX</span><h2 id="widget-dialog-title">{widget ? 'Configurar indicador' : 'Adicionar indicador'}</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" size={17} /></button></div>
        <label className="dialog-field widget-host-field"><span>Equipamento</span><select autoFocus value={hostId} onChange={(event) => { setHostId(event.target.value); setItemId(''); setItemPickerValue(''); setSelectedItemIds([]); setSelectedItemDetails([]); setTitle(''); setSearch(''); setItemPage(0); setHasMoreItems(false); setCatalog([]) }} required><option value="">{hostsLoading ? 'Carregando equipamentos...' : 'Selecione um equipamento...'}</option>{hosts.map((host) => <option key={host.hostId} value={host.hostId}>{host.hostName}</option>)}</select></label>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        {hostId && <>
          {!sectionId && <label className="dialog-field widget-type-field"><span>Tipo de visualização</span><select value={type} onChange={(event) => { const nextType = event.target.value; setType(nextType); if (nextType !== 'timeseries') { setSelectedItemIds((current) => current.slice(0, 1)); setItemId((current) => current || String(selectedItemIds[0] || '')) } }}>
            {['network', 'topology'].includes(dashboardType) ? <><option value="availability">Host UP / DOWN</option><option value="timeseries">Gráfico temporal (até 8 itens)</option></> : <><option value="timeseries">Gráfico temporal (até 8 itens)</option><option value="metric">Valor atual</option></>}
          </select></label>}
          {type === 'timeseries' && <label className="dialog-field widget-range-field"><span>Período do gráfico</span><select value={range} onChange={(event) => setRange(event.target.value)}><option value="15m">Últimos 15 minutos</option><option value="1h">Última hora</option><option value="6h">Últimas 6 horas</option><option value="24h">Último dia</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias (mensal)</option></select></label>}
          {type === 'availability' && dashboardType === 'topology' && <label className="dialog-field"><span>Tamanho do bloco (px)</span><input type="number" min="56" max="480" step="8" value={mapSizePx} onChange={(event) => setMapSizePx(Math.max(56, Math.min(480, Number(event.target.value) || 56)))} /><span className="dialog-hint">Largura e altura iguais. Padrão: 80 × 80 px.</span></label>}
          <label className="dialog-field widget-search-field"><span>Buscar item deste equipamento</span><input value={search} onChange={(event) => { setSearch(event.target.value); setItemPage(0); setHasMoreItems(false); setCatalog([]) }} placeholder={type === 'availability' ? 'icmpping, ping, status...' : 'CPU, memória, tráfego enviado/recebido...'} /></label>
          {type === 'timeseries' ? (
            <div className="dialog-field widget-items-field"><span>Itens do gráfico <small>{selectedItemIds.length} de 8 selecionados</small></span>
              <select className="item-picker-select" aria-label="Selecione um item para adicionar ao gráfico" value={itemPickerValue} onChange={(event) => {
                const nextValue = event.target.value
                const item = catalog.find((entry) => String(entry.itemId) === nextValue)
                if (item) toggleItem(item)
                setItemPickerValue('')
              }}>
                <option value="">{itemsLoading ? 'Carregando itens...' : 'Selecione um item...'}</option>
                {catalog.map((item) => {
                  const isSelected = selectedItemIds.includes(item.itemId)
                  return <option key={item.itemId} value={item.itemId} disabled={isSelected || selectedItemIds.length >= 8}>{item.itemName}{item.unit ? ` (${item.unit})` : ''}{isSelected ? ' — já adicionado' : ''}</option>
                })}
                {!catalog.length && !itemsLoading && <option value="" disabled>Nenhum item encontrado</option>}
              </select>
              <div className="selected-item-list" aria-label="Itens selecionados para o gráfico">
                {!selectedItems.length && <span className="item-selection-empty">Os itens escolhidos aparecerão aqui. Pesquise e selecione um item para começar.</span>}
                {selectedItems.map((item) => <div className="selected-item-row" key={item.itemId}>
                  <span className="selected-item-marker" aria-hidden="true" />
                  <span className="selected-item-copy"><strong>{item.itemName}</strong><small>{item.unit || 'sem unidade'} <i>·</i> {item.key || 'chave do Zabbix'}</small></span>
                  <button type="button" onClick={() => toggleItem(item)} aria-label={`Remover ${item.itemName} do gráfico`}>Remover</button>
                </div>)}
              </div>
              <span className="item-picker-hint">Escolha até 8 itens do equipamento. Itens com unidades diferentes recebem escalas próprias no gráfico.</span>
              {hasMoreItems && <button className="catalog-more" type="button" disabled={itemsLoading} onClick={() => { setItemsLoading(true); setItemPage((current) => current + 1) }}>{itemsLoading ? 'Carregando...' : 'Carregar mais itens'}</button>}
            </div>
          ) : (
            <label className="dialog-field"><span>{type === 'availability' ? 'Item de estado (1 = UP, 0 = DOWN)' : 'Item do Zabbix'}</span><select value={itemId} onChange={(event) => { setItemId(event.target.value); setSelectedItemIds(event.target.value ? [Number(event.target.value)] : []); setTitle('') }} required><option value="">{itemsLoading ? 'Carregando itens...' : 'Selecione um item...'}</option>{selected && !catalog.some((item) => String(item.itemId) === itemId) && <option value={selected.itemId}>{selected.itemName}</option>}{catalog.map((item) => <option key={item.itemId} value={item.itemId}>{item.itemName}{item.unit ? ` (${item.unit})` : ''}</option>)}</select></label>
          )}
          {itemError && <p className="dialog-error" role="alert">{itemError}</p>}
          {!itemsLoading && !itemError && !catalog.length && <p className="dialog-hint">Nenhum item numérico disponível para este equipamento.</p>}
        </>}
        <label className="dialog-field widget-title-field"><span>Título do widget</span><input value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder={selected?.itemName || 'Título personalizado'} /></label>
        {type === 'availability' && <p className="dialog-hint">Use um item como <strong>icmpping</strong> que retorna 1 quando responde e 0 quando cai. A recuperação fica amarela por 30s; quedas ficam vermelhas e oscilações frequentes amarelas.</p>}
        <div className="dialog-actions"><button className="dialog-cancel" type="button" onClick={onClose}>Cancelar</button><button className="dialog-submit" type="submit" disabled={!selected || hostsLoading || itemsLoading || (type === 'timeseries' && !selectedItems.length)}>{widget ? 'Salvar alterações' : 'Adicionar ao painel'}</button></div>
      </form>
    </div>
  )
}

function DashboardCreateDialog({ onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('general')

  function submit(event) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (cleanTitle) onCreate({ title: cleanTitle, type })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="section-dialog" role="dialog" aria-modal="true" aria-labelledby="new-dashboard-title" onSubmit={submit}>
        <div className="dialog-heading"><div><span className="eyebrow">NOVO PAINEL</span><h2 id="new-dashboard-title">Criar painel</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" size={17} /></button></div>
        <label className="dialog-field"><span>Nome do painel</span><input autoFocus maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Rede e conectividade" required /></label>
        <label className="dialog-field"><span>Tipo de painel</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="general">Geral — indicadores e gráficos</option><option value="network">Rede — disponibilidade e tráfego</option><option value="topology">Mapa — hosts e gráficos organizáveis</option></select></label>
        <p className="dialog-hint">{type === 'topology' ? 'Começa vazio: adicione hosts e gráficos, arraste para organizar em grade e use − / + para ajustar o tamanho dos blocos.' : type === 'network' ? 'O painel começará vazio. Adicione cards UP/DOWN e gráficos de uma ou mais interfaces.' : 'O painel começará vazio e aceitará indicadores de valor e gráficos.'}</p>
        <div className="dialog-actions"><button className="dialog-cancel" type="button" onClick={onClose}>Cancelar</button><button className="dialog-submit" type="submit">Criar painel</button></div>
      </form>
    </div>
  )
}

const ROLE_LABELS = {
  administrator: 'Administrator · acesso total',
  moderator: 'Moderador · adiciona e move',
  view: 'Visualizador · painéis atribuídos',
}

function LoginScreen({ onLogin, loading, error }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function submit(event) {
    event.preventDefault()
    onLogin(username, password)
  }

  return (
    <main className="login-screen">
      <div className="login-glow" />
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand"><span className="brand-symbol"><Icon name="activity" size={21} /></span><span className="brand-name">NTIBIX<small>MONITORAMENTO E OBSERVABILIDADE</small></span></div>
        <div className="eyebrow"><span className="eyebrow-line" />ACESSO SEGURO · NTI</div>
        <h1>Bem-vindo de volta</h1>
        <p>Entre para acessar os painéis de monitoramento.</p>
        <label className="dialog-field"><span>Usuário</span><input autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Seu usuário" required /></label>
        <label className="dialog-field"><span>Senha</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" required /></label>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <button className="dialog-submit login-submit" type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
        <small className="login-footnote">Acesso monitorado · NTIBIX</small>
      </form>
    </main>
  )
}

function UnauthorizedScreen({ onLoginRoute, noAssignedDashboards = false, onLogout }) {
  useEffect(() => {
    if (noAssignedDashboards) return undefined
    const timeout = window.setTimeout(onLoginRoute, 1400)
    return () => window.clearTimeout(timeout)
  }, [noAssignedDashboards, onLoginRoute])

  return (
    <main className="login-screen">
      <section className="login-card unauthorized-card" role="status">
        <span className="unauthorized-icon"><Icon name="shield" size={24} /></span>
        <div className="eyebrow"><span className="eyebrow-line" />ACESSO PROTEGIDO · NTI</div>
        <h1>{noAssignedDashboards ? 'Acesso ainda não atribuído' : 'Acesso não autorizado'}</h1>
        <p>{noAssignedDashboards
          ? 'Sua conta está ativa, mas ainda não tem painéis atribuídos. Peça ao administrador que configure seu acesso.'
          : 'Você precisa entrar para acessar esta página. Redirecionando para o login…'}</p>
        {noAssignedDashboards
          ? <button className="edit-panel-button" type="button" onClick={onLogout}>Sair</button>
          : <button className="edit-panel-button" type="button" onClick={onLoginRoute}>Ir para o login</button>}
      </section>
    </main>
  )
}

function UserAdministration({ dashboards, currentUser }) {
  const [users, setUsers] = useState([])
  const [drafts, setDrafts] = useState({})
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('view')
  const [dashboardIds, setDashboardIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [userToDelete, setUserToDelete] = useState(null)

  const fetchUsers = useCallback(async (signal) => {
    const response = await fetch('/api/users', { signal })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os usuários.')
    return payload
  }, [])

  const loadUsers = useCallback(async () => {
    try {
      const payload = await fetchUsers()
      setUsers(payload)
      setDrafts(Object.fromEntries(payload.map((user) => [user.id, {
        role: user.role,
        dashboardIds: user.dashboardIds,
        password: '',
      }])))
      setError('')
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível carregar os usuários.')
    } finally { setLoading(false) }
  }, [fetchUsers])

  useEffect(() => {
    const controller = new AbortController()
    fetchUsers(controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return
        setUsers(payload)
        setDrafts(Object.fromEntries(payload.map((user) => [user.id, {
          role: user.role,
          dashboardIds: user.dashboardIds,
          password: '',
        }])))
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [fetchUsers])

  const toggleDashboard = (ids, targetId) => ids.includes(targetId)
    ? ids.filter((id) => id !== targetId)
    : [...ids, targetId]

  async function createUser(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role, dashboardIds: role === 'view' ? dashboardIds : [] }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível criar o usuário.')
      setUsername('')
      setPassword('')
      setDashboardIds([])
      setNotice(`Usuário ${payload.username} criado.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível criar o usuário.')
    } finally {
      setSaving(false)
    }
  }

  async function saveUser(user) {
    const draft = drafts[user.id]
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: draft.role,
          dashboardIds: draft.dashboardIds,
          password: draft.password,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o usuário.')
      setNotice(`Permissões de ${payload.username} atualizadas.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível salvar o usuário.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteUser(user) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Não foi possível excluir o usuário.')
      setNotice(`Usuário ${user.username} excluído.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível excluir o usuário.')
    } finally {
      setSaving(false)
    }
  }

  async function setUserDisabled(user, disabled) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível alterar o estado do usuário.')
      setNotice(`Conta ${payload.disabled ? 'desativada' : 'ativada'}: ${payload.username}.`)
      await loadUsers()
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível alterar o usuário.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="content-section user-admin">
      <div className="user-admin-intro"><div><h2>Contas e grupos de acesso</h2><p>Controle quem pode administrar, organizar ou apenas visualizar cada painel.</p></div><span className="user-admin-badge">{users.length} usuários</span></div>
      {error && <div className="error-banner" role="alert"><Icon name="alert" size={17} /><span>{error}</span></div>}
      {notice && <p className="user-admin-notice" role="status">{notice}</p>}
      <form className="user-create-form" onSubmit={createUser}>
        <h3>Criar usuário</h3>
        <div className="user-create-fields">
          <label className="dialog-field"><span>Nome de usuário</span><input minLength="3" maxLength="40" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ex.: operador-01" required /></label>
          <label className="dialog-field"><span>Senha inicial · mínimo 12 caracteres</span><input type="password" minLength="12" maxLength="200" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label className="dialog-field"><span>Grupo</span><select value={role} onChange={(event) => { setRole(event.target.value); setDashboardIds([]) }}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {role === 'view' && <fieldset className="dashboard-permissions"><legend>Painéis que este usuário poderá visualizar</legend>{dashboards.map((dashboard) => <label key={dashboard.id}><input type="checkbox" checked={dashboardIds.includes(dashboard.id)} onChange={() => setDashboardIds((current) => toggleDashboard(current, dashboard.id))} />{dashboard.title}</label>)}</fieldset>}
        <button className="edit-panel-button" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Criar usuário'}</button>
      </form>
      <div className="user-list">
        {loading ? <div className="loading-banner"><span className="loading-spinner" /><div><strong>Carregando usuários</strong></div></div> : users.map((user) => {
          const draft = drafts[user.id] || { role: user.role, dashboardIds: user.dashboardIds, password: '' }
          const isSelf = user.id === currentUser.id
          return (
            <article className="user-row" key={user.id}>
              <div className="user-row-heading"><span className={`user-state ${user.disabled ? 'disabled' : ''}`} /><div><strong>{user.username}</strong><small>{user.disabled ? 'Conta desativada' : ROLE_LABELS[user.role]}</small></div>{isSelf && <span className="user-self-tag">Sua conta</span>}</div>
              <div className="user-row-edit">
                <label className="dialog-field"><span>Grupo</span><select value={draft.role} disabled={isSelf} onChange={(event) => setDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], role: event.target.value, dashboardIds: event.target.value === 'view' ? current[user.id].dashboardIds : [] } }))}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="dialog-field"><span>Redefinir senha (opcional)</span><input type="password" minLength="12" maxLength="200" autoComplete="new-password" value={draft.password} placeholder="Mínimo 12 caracteres" onChange={(event) => setDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], password: event.target.value } }))} /></label>
              </div>
              {draft.role === 'view' && <fieldset className="dashboard-permissions"><legend>Painéis atribuídos</legend>{dashboards.map((dashboard) => <label key={dashboard.id}><input type="checkbox" checked={draft.dashboardIds.includes(dashboard.id)} onChange={() => setDrafts((current) => ({ ...current, [user.id]: { ...current[user.id], dashboardIds: toggleDashboard(current[user.id].dashboardIds, dashboard.id) } }))} />{dashboard.title}</label>)}</fieldset>}
              <div className="user-row-actions"><button className="edit-panel-button" type="button" disabled={saving} onClick={() => saveUser(user)}>Salvar permissões</button>{!isSelf && <><button className="section-action" type="button" disabled={saving} onClick={() => setUserDisabled(user, !user.disabled)}>{user.disabled ? 'Ativar conta' : 'Desativar conta'}</button><button className="section-action section-delete" type="button" disabled={saving} onClick={() => setUserToDelete(user)} aria-label={`Excluir ${user.username}`}><Icon name="trash" size={14} /></button></>}</div>
            </article>
          )
        })}
      </div>
      {userToDelete && <ConfirmDialog title="Excluir usuário?" message={`A conta de ${userToDelete.username} será removida. Esta ação não pode ser desfeita.`} onCancel={() => setUserToDelete(null)} onConfirm={async () => {
        const target = userToDelete
        setUserToDelete(null)
        await deleteUser(target)
      }} busy={saving} />}
    </section>
  )
}

function App() {
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loginLoading, setLoginLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [dashboard, setDashboard] = useState({ icmp: [], servers: [], alerts: [], updatedAt: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [clockNow, setClockNow] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [layout, setLayout] = useState(EMPTY_LAYOUT)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [config, setConfig] = useState(null)
  const [page, setPage] = useState('overview')
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [widgetDialog, setWidgetDialog] = useState(null)
  const [dashboardCreateOpen, setDashboardCreateOpen] = useState(false)
  const [alertFilter, setAlertFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [alertPeriod, setAlertPeriod] = useState('all')
  const [kioskMode, setKioskMode] = useState(false)
  const [kioskPaused, setKioskPaused] = useState(false)
  const [configError, setConfigError] = useState('')
  const [sectionDialog, setSectionDialog] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [mapClipboard, setMapClipboard] = useState(null)
  const [widgetHistories, setWidgetHistories] = useState({})
  const [saveNotice, setSaveNotice] = useState(null)
  const requestInProgress = useRef(false)
  const configSaveQueue = useRef(Promise.resolve())
  const saveRevision = useRef(0)
  const lastPersistedSnapshot = useRef('')
  const isAdministrator = authUser?.role === 'administrator'
  const canEditDashboard = authUser?.role === 'administrator' || authUser?.role === 'moderator'
  const activeLayout = useMemo(() => page === 'connectivity'
    ? { ...EMPTY_CONNECTIVITY_LAYOUT, ...config?.connectivityLayout }
    : page === 'servers'
      ? { ...EMPTY_SERVER_LAYOUT, ...config?.serverLayout }
      : { ...EMPTY_LAYOUT, ...layout }, [config?.connectivityLayout, config?.serverLayout, layout, page])

  const updateActiveLayout = (updater) => {
    if (page === 'connectivity' || page === 'servers') {
      setConfig((current) => ({
        ...current,
        ...(page === 'connectivity'
          ? { connectivityLayout: updater(current.connectivityLayout || EMPTY_CONNECTIVITY_LAYOUT) }
          : { serverLayout: updater(current.serverLayout || EMPTY_SERVER_LAYOUT) }),
      }))
    } else {
      setLayout(updater)
    }
  }

  const refreshSeconds = config?.preferences?.refreshSeconds || 30
  const autoRefresh = config?.preferences?.autoRefresh !== false
  const widgetItemIdsKey = useMemo(
    () => JSON.stringify(Object.fromEntries([...new Set(layout.widgets.map((widget) => widget.range || '1h'))]
      .sort()
      .map((range) => [range, [...new Set(layout.widgets
        .filter((widget) => (widget.range || '1h') === range)
        .flatMap((widget) => widget.itemIds || [widget.itemId])
        .map(Number))].sort((a, b) => a - b)]))),
    [layout.widgets],
  )
  const mapPositions = useMemo(() => resolveMapPositions(layout.widgets.filter((widget) => !widget.sectionId)), [layout.widgets])
  const mapCanvasHeight = Math.max(360, ...mapPositions.map((item) => item.mapY + item.height + 24))

  const loadDashboard = useCallback(async (signal) => {
    if (!authUser) return
    try {
      const response = await fetch('/api/dashboard', { signal })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os dados.')
      setDashboard((current) => ({ ...current, ...payload }))
      setError('')
      setLastUpdated(new Date(payload.updatedAt || Date.now()))
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        console.error('Falha ao carregar os dados de monitoramento:', requestError)
        setError(requestError.message === 'Failed to fetch'
          ? 'Falha ao conectar à API de monitoramento. Verifique a conexão e tente novamente.'
          : requestError.message || 'Falha ao conectar à API de monitoramento.')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [authUser])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/me', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || 'Sua sessão não está autenticada.')
        setAuthUser(payload.user)
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          setAuthUser(null)
          if (!['#/login', '#/unauthorized'].includes(window.location.hash.split('?')[0])) {
            window.location.hash = '#/unauthorized'
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthLoading(false)
      })
    return () => controller.abort()
  }, [])

  const handleLogin = async (username, password) => {
    setLoginLoading(true)
    setAuthError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível entrar.')
      setAuthUser(payload.user)
      const nextRoute = payload.user.role === 'view'
        ? payload.user.dashboardIds[0] ? `#/dashboard/${payload.user.dashboardIds[0]}` : '#/unauthorized'
        : '#/overview'
      window.location.hash = nextRoute
    } catch (requestError) {
      setAuthError(requestError.message || 'Não foi possível entrar.')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (requestError) {
      console.error('Falha ao encerrar a sessão no servidor:', requestError)
    } finally {
      setAuthUser(null)
      setConfig(null)
      setLayoutLoaded(false)
      window.location.hash = '#/unauthorized'
    }
  }, [])
  const goToLogin = useCallback(() => { window.location.hash = '#/login' }, [])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      if (requestInProgress.current) return
      requestInProgress.current = true
      try {
        await loadDashboard(controller.signal)
      } finally {
        requestInProgress.current = false
      }
    }
    const initialLoad = window.setTimeout(refresh, 0)
    const interval = autoRefresh ? window.setInterval(refresh, refreshSeconds * 1000) : null
    return () => {
      controller.abort()
      window.clearTimeout(initialLoad)
      if (interval) window.clearInterval(interval)
    }
  }, [authUser, autoRefresh, refreshSeconds, loadDashboard])

  useEffect(() => {
    if (!authUser || page !== 'dashboard' || !widgetItemIdsKey) return undefined
    const itemsByRange = JSON.parse(widgetItemIdsKey)
    const itemKeys = Object.entries(itemsByRange).flatMap(([range, itemIds]) => itemIds.map((itemId) => `${range}:${itemId}`))
    let active = true
    let inFlight = false
    let controller

    const refreshWidgetHistories = async () => {
      if (inFlight) return
      inFlight = true
      controller = new AbortController()
      const loaded = {}
      try {
        for (const [range, itemIds] of Object.entries(itemsByRange)) {
          for (let offset = 0; offset < itemIds.length; offset += 100) {
            const batch = itemIds.slice(offset, offset + 100)
            const params = new URLSearchParams({ itemIds: batch.join(','), range })
            const response = await fetch(`/api/history?${params}`, { signal: controller.signal })
            const payload = await response.json()
            if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o histórico dos indicadores.')
            for (const itemId of batch) {
              if (payload[itemId]) loaded[`${range}:${itemId}`] = payload[itemId]
            }
          }
        }
        if (active) {
          setWidgetHistories((current) => {
            const next = Object.fromEntries(Object.entries(current).filter(([key]) => itemKeys.includes(key)))
            for (const key of itemKeys) {
              next[key] = loaded[key]
                ? { history: loaded[key], error: '' }
                : { history: null, error: 'O item não está mais disponível no Zabbix.' }
            }
            return next
          })
        }
      } catch (requestError) {
        if (active && requestError.name !== 'AbortError') {
          console.error('Falha ao carregar os históricos dos indicadores:', requestError)
          const message = requestError.message === 'Failed to fetch'
            ? 'Não foi possível conectar ao serviço de histórico.'
            : requestError.message
          setWidgetHistories((current) => Object.fromEntries(itemKeys.map((key) => [
            key,
            { history: current[key]?.history || null, error: message },
          ])))
        }
      } finally {
        inFlight = false
      }
    }

    refreshWidgetHistories()
    if (!autoRefresh) return () => {
      active = false
      controller?.abort()
    }
    const interval = window.setInterval(refreshWidgetHistories, refreshSeconds * 1000)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(interval)
    }
  }, [authUser, autoRefresh, page, refreshSeconds, widgetItemIdsKey])

  useEffect(() => {
    if (!authUser) return undefined
    const controller = new AbortController()
    fetch('/api/dashboard-config', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar as configurações.')
        const dashboards = Array.isArray(payload.dashboards) ? payload.dashboards : []
        const routeDashboardId = window.location.hash.startsWith('#/dashboard/')
          ? window.location.hash.slice('#/dashboard/'.length).split(/[?&]/)[0]
          : null
        const active = dashboards.find((item) => item.id === routeDashboardId)
          || dashboards.find((item) => item.id === payload.defaultDashboardId)
          || dashboards.find((item) => item.id === payload.activeDashboardId)
          || dashboards[0]
        if (!active) throw new Error('Nenhum dashboard válido foi encontrado na configuração.')
        const loadedConfig = { ...payload, activeDashboardId: active.id }
        lastPersistedSnapshot.current = JSON.stringify(loadedConfig)
        setConfig(loadedConfig)
        setLayout(active)
        setConfigError('')
        setLayoutLoaded(true)
        if (window.location.hash.startsWith('#/')) setPage(window.location.hash.slice(2).split('/')[0])
        else {
          setPage('dashboard')
          window.location.hash = `#/dashboard/${active.id}`
        }
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') {
          console.error('Falha ao carregar as configurações do painel:', requestError)
          setConfigError(requestError.message === 'Failed to fetch'
            ? 'Não foi possível conectar ao serviço de configurações.'
            : requestError.message)
          setLayoutLoaded(true)
        }
      })
    return () => controller.abort()
  }, [authUser])

  useEffect(() => {
    if (!authUser || authUser.role === 'view' || !layoutLoaded || !config) return undefined
    const revision = ++saveRevision.current
    const persistedConfig = {
      ...config,
      activeDashboardId: layout.id,
      dashboards: config.dashboards.map((item) => item.id === layout.id ? layout : item),
    }
    const snapshot = JSON.stringify(persistedConfig)
    if (snapshot === lastPersistedSnapshot.current) {
      const timeout = window.setTimeout(() => {
        if (revision === saveRevision.current) setSaveNotice(null)
      }, 0)
      return () => window.clearTimeout(timeout)
    }
    const timeout = window.setTimeout(async () => {
      setSaveNotice({ type: 'saving', message: 'Salvando configurações...' })
      configSaveQueue.current = configSaveQueue.current
        .catch(() => {})
        .then(async () => {
          const response = await fetch('/api/dashboard-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(persistedConfig),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o dashboard.')
          lastPersistedSnapshot.current = snapshot
          if (revision === saveRevision.current) {
            setConfigError('')
            setSaveNotice({ type: 'success', message: 'Configurações salvas com sucesso.' })
          }
        })
        .catch((requestError) => {
          console.error('Falha ao salvar as configurações do painel:', requestError)
          const message = requestError.message === 'Failed to fetch'
            ? 'Não foi possível conectar ao serviço para salvar as alterações.'
            : requestError.message || 'Não foi possível salvar o painel.'
          if (revision === saveRevision.current) {
            setConfigError(message)
            setSaveNotice({ type: 'error', message: 'Não foi possível salvar as configurações.' })
          }
        })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [authUser, layout, config, layoutLoaded])

  useEffect(() => {
    if (saveNotice?.type !== 'success') return undefined
    const timeout = window.setTimeout(() => setSaveNotice(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [saveNotice])

  useEffect(() => {
    const onHashChange = () => {
      const [nextPage, dashboardId] = window.location.hash.slice(2).split('/')
      if (!authUser) {
        if (nextPage !== 'login' && nextPage !== 'unauthorized') {
          window.location.hash = '#/unauthorized'
          return
        }
        setPage(nextPage || 'login')
        return
      }
      if (authUser.role === 'view') {
        if (nextPage === 'login' || nextPage === 'unauthorized') return
        if (nextPage !== 'dashboard' && nextPage !== 'dashboards') {
          window.location.hash = authUser.dashboardIds[0]
            ? `#/dashboard/${authUser.dashboardIds[0]}`
            : '#/unauthorized?reason=no-dashboard'
          return
        }
      }
      setPage(nextPage || 'overview')
      if (dashboardId && config) {
        const selected = config.dashboards.find((item) => item.id === dashboardId)
        if (selected) {
          setLayout(selected)
          setConfig((current) => ({ ...current, activeDashboardId: selected.id }))
        } else if (authUser.role === 'view') {
          window.location.hash = authUser.dashboardIds[0]
            ? `#/dashboard/${authUser.dashboardIds[0]}`
            : '#/unauthorized?reason=no-dashboard'
        }
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [authUser, config])

  useEffect(() => {
    if (!authUser) return
    if (authUser.role === 'view' && !authUser.dashboardIds.length) {
      if (!window.location.hash.includes('reason=no-dashboard')) window.location.hash = '#/unauthorized?reason=no-dashboard'
      return
    }
    if (page === 'login' || page === 'unauthorized') {
      window.location.hash = authUser.role === 'view'
        ? `#/dashboard/${authUser.dashboardIds[0]}`
        : '#/overview'
      return
    }
    if (authUser.role === 'view' && !['dashboard', 'dashboards'].includes(page)) {
      window.location.hash = `#/dashboard/${authUser.dashboardIds[0]}`
      return
    }
    if (page === 'users' && !isAdministrator) window.location.hash = '#/overview'
    if (page === 'settings' && !isAdministrator) window.location.hash = '#/overview'
  }, [authUser, isAdministrator, page])

  useEffect(() => {
    if (!authUser) return undefined
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch('/api/auth/me')
        if (response.status === 401) {
          setAuthUser(null)
          window.location.hash = '#/unauthorized'
        }
      } catch (requestError) {
        console.error('Falha ao validar a sessão:', requestError)
      }
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [authUser])

  useEffect(() => {
    if (!kioskMode || kioskPaused || !config?.preferences.kiosk.rotationEnabled) return undefined
    const rotationIds = config.preferences.kiosk.dashboardIds.length
      ? config.preferences.kiosk.dashboardIds
      : config.dashboards.map((item) => item.id)
    if (rotationIds.length < 2) return undefined
    const interval = window.setInterval(() => {
      const currentIndex = rotationIds.indexOf(layout.id)
      const nextId = rotationIds[(currentIndex + 1 + rotationIds.length) % rotationIds.length]
      window.location.hash = `#/dashboard/${nextId}`
    }, config.preferences.kiosk.secondsPerDashboard * 1000)
    return () => window.clearInterval(interval)
  }, [config, kioskMode, kioskPaused, layout.id])

  useEffect(() => {
    const handleFullscreen = () => {
      if (!document.fullscreenElement) setKioskMode(false)
    }
    document.addEventListener('fullscreenchange', handleFullscreen)
    return () => document.removeEventListener('fullscreenchange', handleFullscreen)
  }, [])

  useEffect(() => {
    const updateNow = () => setClockNow(Date.now())
    const initial = window.setTimeout(updateNow, 0)
    const interval = window.setInterval(updateNow, 10_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = config?.preferences.theme || 'dark'
  }, [config?.preferences.theme])

  const icmpHosts = useMemo(
    () => orderVisible(dashboard.icmp, activeLayout.orderIcmp, activeLayout.hiddenIcmp)
      .filter((host) => host.host_name.toLowerCase().includes(search.toLowerCase())),
    [dashboard.icmp, activeLayout, search],
  )
  const servers = useMemo(
    () => orderVisible(dashboard.servers, activeLayout.orderServers, activeLayout.hiddenServers)
      .filter((server) => server.host_name.toLowerCase().includes(search.toLowerCase())),
    [dashboard.servers, activeLayout, search],
  )
  const cardsForSection = (section) => {
    const isIcmp = section.kind === 'icmp'
    const items = isIcmp ? icmpHosts : servers
    const order = isIcmp ? activeLayout.orderIcmp : activeLayout.orderServers
    const hidden = isIcmp ? activeLayout.hiddenIcmp : activeLayout.hiddenServers
    const defaultSection = isIcmp ? 'network' : 'servers'
    const assigned = items.filter((item) => (
      page === 'connectivity'
        ? activeLayout.assignments[item.host_name] === section.id
        : (activeLayout.assignments[item.host_name] || item.default_section_id || defaultSection) === section.id
    ))
    return orderVisible(assigned, order, hidden)
  }

  const availableForSection = (section) => {
    const isIcmp = section.kind === 'icmp'
    const items = isIcmp ? dashboard.icmp : dashboard.servers
    const hidden = isIcmp ? activeLayout.hiddenIcmp : activeLayout.hiddenServers
    if (page === 'connectivity' || page === 'servers') {
      const assignedHosts = new Set(Object.keys(activeLayout.assignments))
      return items.filter((item) => !hidden.includes(item.host_name) && !assignedHosts.has(item.host_name))
    }
    const defaultSection = isIcmp ? 'network' : 'servers'
    const alreadyInSection = new Set(items
      .filter((item) => !hidden.includes(item.host_name)
        && (activeLayout.assignments[item.host_name] || item.default_section_id || defaultSection) === section.id)
      .map((item) => item.host_name))
    return items.filter((item) => !alreadyInSection.has(item.host_name))
  }

  const handleRemoveCard = (kind, hostName) => {
    if (page === 'connectivity') {
      updateActiveLayout((current) => {
        const assignments = { ...current.assignments }
        delete assignments[hostName]
        return { ...current, assignments }
      })
      return
    }
    if (page === 'servers') {
      updateActiveLayout((current) => {
        const assignments = { ...current.assignments }
        if (assignments[hostName]) {
          delete assignments[hostName]
          return { ...current, assignments }
        }
        return { ...current, hiddenServers: [...new Set([...current.hiddenServers, hostName])] }
      })
      return
    }
    const hiddenKey = kind === 'icmp' ? 'hiddenIcmp' : 'hiddenServers'
    updateActiveLayout((current) => ({
      ...current,
      [hiddenKey]: [...new Set([...current[hiddenKey], hostName])],
    }))
  }

  const handleAddCard = (section, hostName) => {
    if (page === 'connectivity' || page === 'servers') {
      updateActiveLayout((current) => ({
        ...current,
        ...(page === 'servers' ? { hiddenServers: current.hiddenServers.filter((name) => name !== hostName) } : {}),
        assignments: { ...current.assignments, [hostName]: section.id },
      }))
      return
    }
    const hiddenKey = section.kind === 'icmp' ? 'hiddenIcmp' : 'hiddenServers'
    updateActiveLayout((current) => ({
      ...current,
      [hiddenKey]: current[hiddenKey].filter((name) => name !== hostName),
      assignments: { ...current.assignments, [hostName]: section.id },
    }))
  }

  const handleDragStart = (event, section, hostName) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${section.kind}:${section.id}:${hostName}`)
  }

  const handleDrop = (event, targetSection, targetName) => {
    event.preventDefault()
    const [sourceKind, sourceSectionId, sourceName] = event.dataTransfer.getData('text/plain').split(':')
    if (sourceKind !== targetSection.kind || !sourceName) return
    const orderKey = sourceKind === 'icmp' ? 'orderIcmp' : 'orderServers'
    const targetNames = cardsForSection(targetSection).map((item) => item.host_name)
    const fromIndex = targetNames.indexOf(sourceName)
    const toIndex = targetName ? targetNames.indexOf(targetName) : targetNames.length
    if (sourceSectionId === targetSection.id && (fromIndex < 0 || toIndex < 0 || sourceName === targetName)) return
    if (sourceSectionId !== targetSection.id && toIndex < 0 && targetName) return
    if (fromIndex >= 0) targetNames.splice(fromIndex, 1)
    const insertAt = targetName ? Math.max(0, targetNames.indexOf(targetName)) : targetNames.length
    targetNames.splice(insertAt, 0, sourceName)

    updateActiveLayout((current) => ({
      ...current,
      [orderKey]: [...targetNames, ...current[orderKey].filter((name) => !targetNames.includes(name))],
      assignments: { ...current.assignments, [sourceName]: targetSection.id },
    }))
  }

  const handleSaveSection = (dialog) => {
    if (dialog.mode === 'create') {
      updateActiveLayout((current) => ({
        ...current,
        sections: [...current.sections, { id: crypto.randomUUID(), title: dialog.title, kind: dialog.kind }],
      }))
    } else {
      updateActiveLayout((current) => ({
        ...current,
        sections: current.sections.map((section) => section.id === dialog.id
          ? { ...section, title: dialog.title }
          : section),
      }))
    }
    setSectionDialog(null)
  }

  const handleDeleteSection = (section) => {
    setConfirmation({
      title: 'Excluir seção?',
      message: `A seção "${section.title}" será removida. Os cards ou indicadores associados serão realocados para outra seção do mesmo tipo, se houver.`,
      onConfirm: () => {
        const fallback = activeLayout.sections.find((candidate) => candidate.kind === section.kind && candidate.id !== section.id)
        setConfigError('')
        updateActiveLayout((current) => {
          const assignments = { ...current.assignments }
          for (const [hostName, sectionId] of Object.entries(assignments)) {
            if (sectionId !== section.id) continue
            if (fallback) assignments[hostName] = fallback.id
            else delete assignments[hostName]
          }
          return {
            ...current,
            sections: current.sections.filter((candidate) => candidate.id !== section.id),
            assignments,
            widgets: section.kind === 'consumption'
              ? current.widgets.map((widget) => {
                if (widget.sectionId !== section.id) return widget
                if (fallback) return { ...widget, sectionId: fallback.id }
                return Object.fromEntries(Object.entries(widget).filter(([key]) => key !== 'sectionId'))
              })
              : current.widgets,
          }
        })
      },
    })
  }

  const createDashboard = ({ title, type }) => {
    const next = {
      ...EMPTY_LAYOUT,
      id: `dashboard-${crypto.randomUUID()}`,
      title,
      type,
      favorite: false,
      sections: [],
      hiddenIcmp: [],
      hiddenServers: [],
      orderIcmp: [],
      orderServers: [],
      assignments: {},
      widgets: [],
    }
    setConfig((current) => ({
      ...current,
      dashboards: [...current.dashboards, next],
      activeDashboardId: next.id,
    }))
    setLayout(next)
    setDashboardCreateOpen(false)
    window.location.hash = `#/dashboard/${next.id}`
  }

  const duplicateDashboard = (source) => {
    const copy = {
      ...source,
      id: `dashboard-${crypto.randomUUID()}`,
      title: `${source.title} (cópia)`,
      favorite: false,
      sections: source.sections.map((section) => ({ ...section })),
      assignments: { ...source.assignments },
      widgets: source.widgets.map((widget) => ({ ...widget, id: crypto.randomUUID() })),
    }
    setConfig((current) => ({ ...current, dashboards: [...current.dashboards, copy] }))
  }

  const renameDashboard = (target) => {
    const title = window.prompt('Novo nome do painel', target.title)?.trim()
    if (!title) return
    const renamed = { ...target, title: title.slice(0, 100) }
    setConfig((current) => ({
      ...current,
      dashboards: current.dashboards.map((item) => item.id === target.id ? renamed : item),
    }))
    if (layout.id === target.id) setLayout(renamed)
  }

  const deleteDashboard = (target) => {
    if (config.dashboards.length <= 1) {
      setConfigError('Mantenha pelo menos um painel.')
      return
    }
    setConfirmation({
      title: 'Excluir painel?',
      message: `O painel "${target.title}" e suas configurações serão removidos. Esta ação não pode ser desfeita.`,
      onConfirm: () => {
        const remaining = config.dashboards.filter((item) => item.id !== target.id)
        const next = remaining[0]
        setConfig((current) => ({
          ...current,
          dashboards: remaining,
          activeDashboardId: target.id === layout.id ? next.id : current.activeDashboardId,
          defaultDashboardId: target.id === current.defaultDashboardId ? next.id : current.defaultDashboardId,
          preferences: {
            ...current.preferences,
            kiosk: { ...current.preferences.kiosk, dashboardIds: current.preferences.kiosk.dashboardIds.filter((id) => id !== target.id) },
          },
        }))
        if (target.id === layout.id) {
          setLayout(next)
          window.location.hash = `#/dashboard/${next.id}`
        }
      },
    })
  }

  const copyMap = () => {
    setMapClipboard({ title: layout.title, widgets: resolveMapPositions(layout.widgets) })
    setSaveNotice({ type: 'success', message: `Mapa "${layout.title}" copiado.` })
  }

  const pasteMap = () => {
    if (!mapClipboard?.widgets.length) return
    setLayout((current) => {
      const destinationBottom = Math.max(0, ...resolveMapPositions(current.widgets).map((item) => item.mapY + item.height)) + 24
      const sourceTop = Math.min(...mapClipboard.widgets.map((item) => item.mapY))
      const verticalOffset = destinationBottom - sourceTop
      const widgets = mapClipboard.widgets.map((widget) => {
        return { ...widget, id: crypto.randomUUID(), mapY: widget.mapY + verticalOffset }
      })
      return { ...current, widgets: [...current.widgets, ...widgets] }
    })
    setSaveNotice({ type: 'success', message: `Mapa "${mapClipboard.title}" adicionado ao painel.` })
  }

  const toggleFavorite = (target) => {
    const updated = { ...target, favorite: !target.favorite }
    setConfig((current) => ({
      ...current,
      dashboards: current.dashboards.map((item) => item.id === target.id ? updated : item),
    }))
    if (layout.id === target.id) setLayout(updated)
  }

  const setDefaultDashboard = (target) => {
    setConfig((current) => ({ ...current, defaultDashboardId: target.id }))
  }

  const saveWidget = (widget) => {
    setLayout((current) => ({
      ...current,
      widgets: current.widgets.some((item) => item.id === widget.id)
        ? current.widgets.map((item) => item.id === widget.id ? widget : item)
        : [...current.widgets, widget],
    }))
    setWidgetDialog(null)
  }

  const configureWidget = (widget) => {
    setWidgetDialog(widget)
  }

  const moveWidget = (id, offset) => {
    setLayout((current) => {
      const target = current.widgets.find((item) => item.id === id)
      if (!target) return current
      const group = current.widgets.filter((item) => item.sectionId === target.sectionId)
      const index = group.findIndex((item) => item.id === id)
      const destination = index + offset
      if (destination < 0 || destination >= group.length) return current
      const [moved] = group.splice(index, 1)
      group.splice(destination, 0, moved)
      let groupIndex = 0
      return {
        ...current,
        widgets: current.widgets.map((item) => item.sectionId === target.sectionId ? group[groupIndex++] : item),
      }
    })
  }

  const resizeWidget = (id, offset) => {
    setLayout((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => widget.id === id
        ? current.type === 'topology' && widget.type === 'availability'
          ? { ...widget, mapSizePx: Math.max(56, Math.min(480, (widget.mapSizePx || 80) + offset * 16)) }
          : current.type === 'topology'
            ? { ...widget, mapCols: Math.max(2, Math.min(24, (widget.mapCols || 4) + offset)), mapRows: Math.max(4, Math.min(24, (widget.mapRows || 4) + offset)) }
            : { ...widget, width: Math.max(1, Math.min(4, (widget.width || 1) + offset)) }
        : widget),
    }))
  }

  const resizeGridItemByDrag = (event, onResize) => {
    event.preventDefault()
    event.stopPropagation()
    const grid = event.currentTarget.closest('.icmp-grid, .server-grid, .custom-widget-grid:not(.topology-map)')
    if (!grid) return
    const style = window.getComputedStyle(grid)
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean)
    const columnWidth = columns.length ? Number.parseFloat(columns[0]) + Number.parseFloat(style.columnGap || 0) : 280
    const rowHeight = Number.parseFloat(style.gridAutoRows) || 150
    const maxWidth = Math.min(columns.length || 4, 4)
    const startX = event.clientX
    const startY = event.clientY
    const update = (moveEvent) => {
      onResize(
        Math.round((moveEvent.clientX - startX) / columnWidth),
        Math.round((moveEvent.clientY - startY) / rowHeight),
        maxWidth,
      )
    }
    const stop = () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const resizeWidgetByDrag = (event, widget) => {
    const startWidth = widget.width || 1
    const startHeight = widget.height || (widget.type === 'timeseries' ? 2 : 1)
    let currentWidth = startWidth
    let currentHeight = startHeight
    resizeGridItemByDrag(event, (widthDelta, heightDelta, maxWidth) => {
      const minHeight = widget.type === 'timeseries' ? 2 : 1
      const width = Math.max(1, Math.min(maxWidth, startWidth + widthDelta))
      const height = Math.max(minHeight, Math.min(8, startHeight + heightDelta))
      if (width === currentWidth && height === currentHeight) return
      currentWidth = width
      currentHeight = height
      setLayout((current) => ({
        ...current,
        widgets: current.widgets.map((item) => item.id === widget.id
          ? { ...item, width, height }
          : item),
      }))
    })
  }

  const resizeHostCardByDrag = (event, kind, hostName) => {
    const sizeKey = `${kind}:${hostName}`
    const size = activeLayout.cardSizes[sizeKey] || { width: 1, height: kind === 'servers' ? 3 : 1 }
    let currentWidth = size.width
    let currentHeight = size.height
    resizeGridItemByDrag(event, (widthDelta, heightDelta, maxWidth) => {
      const width = Math.max(1, Math.min(maxWidth, size.width + widthDelta))
      const height = Math.max(1, Math.min(8, size.height + heightDelta))
      if (width === currentWidth && height === currentHeight) return
      currentWidth = width
      currentHeight = height
      updateActiveLayout((current) => ({
        ...current,
        cardSizes: {
          ...current.cardSizes,
          [sizeKey]: { width, height },
        },
      }))
    })
  }

  const moveMapWidgetByPixels = (event, widget) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const sourcePosition = mapPositions.find((item) => item.id === widget.id)
    if (!sourcePosition) return
    const updatePosition = (moveEvent) => {
      const mapX = Math.max(0, Math.round(sourcePosition.mapX + moveEvent.clientX - startX))
      const mapY = Math.max(0, Math.round(sourcePosition.mapY + moveEvent.clientY - startY))
      setLayout((current) => ({
        ...current,
        widgets: current.widgets.map((item) => {
          const position = mapPositions.find((candidate) => candidate.id === item.id)
          return {
            ...item,
            mapX: item.id === widget.id ? mapX : position?.mapX ?? item.mapX ?? 0,
            mapY: item.id === widget.id ? mapY : position?.mapY ?? item.mapY ?? 0,
          }
        }),
      }))
    }
    const stopPosition = () => {
      window.removeEventListener('pointermove', updatePosition)
      window.removeEventListener('pointerup', stopPosition)
      window.removeEventListener('pointercancel', stopPosition)
    }
    window.addEventListener('pointermove', updatePosition)
    window.addEventListener('pointerup', stopPosition)
    window.addEventListener('pointercancel', stopPosition)
  }

  const resizeMapWidgetByDrag = (event, widget) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const startCols = widget.mapCols || 4
    const startRows = widget.mapRows || 4
    const updateSize = (moveEvent) => {
      const mapCols = Math.max(2, Math.min(24, startCols + Math.round((moveEvent.clientX - startX) / 80)))
      const mapRows = Math.max(4, Math.min(24, startRows + Math.round((moveEvent.clientY - startY) / 80)))
      setLayout((current) => ({
        ...current,
        widgets: current.widgets.map((item) => item.id === widget.id ? { ...item, mapCols, mapRows } : item),
      }))
    }
    const stopResize = () => {
      window.removeEventListener('pointermove', updateSize)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }
    window.addEventListener('pointermove', updateSize)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  const acknowledgeAlert = async (alert) => {
    try {
      const response = await fetch(`/api/alerts/${encodeURIComponent(alert.id)}/acknowledge`, { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Não foi possível reconhecer o alerta.')
      setDashboard((current) => ({
        ...current,
        alerts: current.alerts.map((item) => item.id === alert.id ? payload.alert : item),
      }))
    } catch (requestError) {
      console.error('Falha ao reconhecer o alerta:', requestError)
      setConfigError(requestError.message === 'Failed to fetch'
        ? 'Não foi possível conectar ao serviço de alertas.'
        : requestError.message)
    }
  }

  const updatePreference = (key, value) => {
    setConfig((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }))
  }

  const updateAlertRule = (key, value) => {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) return
    setConfig((current) => ({
      ...current,
      alertRules: { ...current.alertRules, [key]: number },
    }))
  }

  const onlineCount = dashboard.icmp.filter((host) => host.status_text === 'ONLINE').length
  const activeAlerts = dashboard.alerts.filter((item) => item.status !== 'resolved')
  const filteredAlerts = dashboard.alerts.filter((alert) => {
    if (alertFilter !== 'all' && alert.status !== alertFilter) return false
    if (severityFilter !== 'all' && alert.severity !== severityFilter) return false
    if (search && !`${alert.hostName} ${alert.description}`.toLowerCase().includes(search.toLowerCase())) return false
    if (alertPeriod !== 'all') {
      const age = clockNow - new Date(alert.startedAt).getTime()
      if (age > Number(alertPeriod) * 86400000) return false
    }
    return true
  }).sort((a, b) => new Date(b.lastOccurrence) - new Date(a.lastOccurrence))
  const criticalAlerts = activeAlerts.filter((item) => item.severity === 'critical').length
  const warningAlerts = activeAlerts.filter((item) => item.severity === 'warning').length
  const unknownHosts = dashboard.icmp.filter((host) => host.status_text === 'SEM DADOS' || host.status_text === 'PING SEM DADOS').length
  const offlineHosts = dashboard.icmp.filter((host) => host.status_text === 'OFFLINE').length
  const degradedLinks = dashboard.icmp.filter((host) => host.status_text === 'ALERTA' || Number(host.icmp_loss) > 0).length
  const highCpuServers = dashboard.servers.filter((server) => Number(server.cpu_pct) >= (config?.alertRules.cpuPct || 90)).length
  const highMemoryServers = dashboard.servers.filter((server) => Number(server.ram_pct) >= (config?.alertRules.memoryPct || 90)).length
  const fullDisks = dashboard.servers.flatMap((server) => server.disks.map((disk) => ({ ...disk, host_name: server.host_name })))
    .filter((disk) => Number(disk.used_pct) >= (config?.alertRules.diskWarningPct || 80))
  const pageHeadings = {
    overview: ['Visão geral', 'Saúde operacional da infraestrutura e incidentes prioritários.'],
    dashboards: ['Painéis', 'Crie, organize e personalize painéis independentes.'],
    dashboard: [layout.title, layout.type === 'topology'
      ? 'Arraste pela alça para posicionar cada item livremente, pixel a pixel; redimensione pelo canto.'
      : layout.type === 'network'
        ? 'Disponibilidade e tráfego de rede monitorados em tempo real.'
        : 'Painel personalizado com métricas reais do Zabbix.'],
    connectivity: ['Conectividade', 'Disponibilidade, latência e perda de pacotes dos links monitorados.'],
    servers: ['Servidores', 'Recursos de CPU, memória e armazenamento disponíveis no Zabbix.'],
    alerts: ['Central de alertas', 'Incidentes ativos, reconhecidos e resolvidos com histórico.'],
    settings: ['Configurações', 'Atualização, apresentação e limites de detecção de anomalias.'],
    users: ['Usuários', 'Contas, grupos e acesso individual aos painéis.'],
  }
  const [headingTitle, headingDescription] = pageHeadings[page] || pageHeadings.overview
  const averageLatency = dashboard.icmp.length
    ? dashboard.icmp.reduce((sum, host) => sum + (Number(host.icmp_ms) || 0), 0) / dashboard.icmp.length
    : null
  const averageCpu = dashboard.servers.length
    ? dashboard.servers.reduce((sum, server) => sum + (Number(server.cpu_pct) || 0), 0) / dashboard.servers.length
    : null

  const updatedLabel = lastUpdated
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(lastUpdated)
    : 'aguardando dados'
  const dataIsStale = Boolean(error || (lastUpdated && clockNow - lastUpdated.getTime() > refreshSeconds * 2000))

  if (authLoading) {
    return <main className="login-screen"><div className="loading-banner"><span className="loading-spinner" /><div><strong>Verificando acesso</strong><span>Validando sua sessão segura…</span></div></div></main>
  }
  if (!authUser) {
    return window.location.hash.startsWith('#/login')
      ? <LoginScreen onLogin={handleLogin} loading={loginLoading} error={authError} />
      : <UnauthorizedScreen onLoginRoute={goToLogin} />
  }
  if (authUser.role === 'view' && authUser.dashboardIds.length === 0) {
    return <UnauthorizedScreen noAssignedDashboards onLogout={handleLogout} />
  }

  return (
    <div className={`app-shell ${kioskMode ? 'kiosk-mode' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <aside className="sidebar">
        <a className="brand" href="#/overview" aria-label="NTIBIX - início">
          <span className="brand-symbol"><Icon name="activity" size={21} /></span>
          <span className="brand-name">NTIBIX<small>MONITORAMENTO E OBSERVABILIDADE</small></span>
        </a>

        <div className="nav-label">MONITORAMENTO</div>
        <nav className="main-nav" aria-label="Navegação principal">
          {authUser.role !== 'view' && <a className={`nav-link ${page === 'overview' ? 'active' : ''}`} href="#/overview"><Icon name="dashboard" /><span>Visão geral</span><span className="nav-active-mark" /></a>}
          <a className={`nav-link ${page === 'dashboards' || page === 'dashboard' ? 'active' : ''}`} href="#/dashboards"><Icon name="dashboard" /><span>Painéis</span><span className="nav-count">{config?.dashboards.length ?? '—'}</span></a>
          {authUser.role !== 'view' && <>
            <a className={`nav-link ${page === 'connectivity' ? 'active' : ''}`} href="#/connectivity"><Icon name="network" /><span>Conectividade</span><span className="nav-count">{dashboard.icmp.length || '—'}</span></a>
            <a className={`nav-link ${page === 'servers' ? 'active' : ''}`} href="#/servers"><Icon name="server" /><span>Servidores</span><span className="nav-count">{dashboard.servers.length || '—'}</span></a>
            <a className={`nav-link ${page === 'alerts' ? 'active' : ''}`} href="#/alerts"><Icon name="alert" /><span>Alertas</span><span className="nav-count">{dashboard.alerts.filter((item) => item.status !== 'resolved').length || '0'}</span></a>
          </>}
        </nav>
        {isAdministrator && <>
          <div className="nav-label nav-label-secondary">PREFERÊNCIAS</div>
          <nav className="main-nav" aria-label="Preferências">
            <a className={`nav-link ${page === 'settings' ? 'active' : ''}`} href="#/settings"><Icon name="edit" /><span>Configurações</span></a>
            <a className={`nav-link ${page === 'users' ? 'active' : ''}`} href="#/users"><Icon name="shield" /><span>Usuários e acesso</span></a>
          </nav>
        </>}

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className={`connection-dot ${error ? 'disconnected' : dashboard.icmp.length || dashboard.servers.length ? '' : 'waiting'}`} />
            <div><strong>{error ? 'API indisponível' : dashboard.icmp.length || dashboard.servers.length ? 'Monitoramento ativo' : 'Aguardando conexão'}</strong><span>Origem: Zabbix SQL</span></div>
          </div>
          <div className="sidebar-version"><Icon name="shield" size={14} /> Acesso seguro · NTI</div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="icon-button sidebar-toggle" type="button" aria-label={sidebarHidden ? 'Mostrar menu lateral' : 'Ocultar menu lateral'} aria-expanded={!sidebarHidden} onClick={() => setSidebarHidden((hidden) => !hidden)} title={sidebarHidden ? 'Mostrar menu lateral' : 'Ocultar menu lateral'}><Icon name="panel" size={17} /></button>
            <div className="breadcrumb"><span>NTI</span><Icon name="chevron" size={14} /><strong>{headingTitle}</strong></div>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Icon name="search" size={17} />
              <input aria-label="Buscar equipamento" placeholder="Buscar equipamento..." value={search} onChange={(event) => setSearch(event.target.value)} />
              <kbd>/</kbd>
            </label>
            <div className={`update-info ${dataIsStale ? 'is-stale' : ''}`}><span className={`pulse-dot ${error ? 'is-error' : ''}`} /><span>{dataIsStale ? 'Dados desatualizados' : 'Atualizado'} <strong>{updatedLabel}</strong></span></div>
            <button className="icon-button" type="button" aria-label="Atualizar agora" onClick={() => loadDashboard()}><Icon name="refresh" size={17} /></button>
            {kioskMode && <button className="icon-button" type="button" onClick={() => setKioskPaused((value) => !value)} aria-label={kioskPaused ? 'Retomar rotação' : 'Pausar rotação'}>{kioskPaused ? '▶' : 'Ⅱ'}</button>}
            <span className="user-role-label">{ROLE_LABELS[authUser.role]?.split(' · ')[0]}</span>
            <button className="user-avatar" type="button" aria-label={`Sair da conta ${authUser.username}`} title={`Sair · ${authUser.username}`} onClick={handleLogout}>{authUser.username.slice(0, 2).toUpperCase()}</button>
          </div>
        </header>

        <div className="dashboard-body">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" />CENTRO DE OPERAÇÕES · NTI</div>
              <h1>{headingTitle}<span>{page === 'overview' ? ' em tempo real.' : ''}</span></h1>
              <p>{headingDescription}</p>
            </div>
            <div className="heading-actions">
              <div className="refresh-chip"><Icon name="clock" size={15} /><span>{autoRefresh ? 'Atualização automática' : 'Atualização pausada'}</span><strong>{refreshSeconds >= 60 ? `${refreshSeconds / 60}min` : `${refreshSeconds}s`}</strong></div>
              {page === 'dashboards' && isAdministrator && <button className="edit-panel-button" type="button" onClick={() => setDashboardCreateOpen(true)}><Icon name="plus" size={15} />Novo painel</button>}
              {page === 'dashboard' && <button className="edit-panel-button" type="button" onClick={() => setWidgetDialog({})}><Icon name="plus" size={15} />{['network', 'topology'].includes(layout.type) ? 'Adicionar host ou gráfico' : 'Adicionar indicador'}</button>}
              {page === 'dashboard' && layout.type === 'topology' && canEditDashboard && <>
                <button className="edit-panel-button" type="button" onClick={copyMap} disabled={!layout.widgets.length}>Copiar mapa</button>
                {mapClipboard && <button className="edit-panel-button" type="button" onClick={pasteMap}>Colar mapa · {mapClipboard.widgets.length}</button>}
              </>}
              {(page === 'overview' || page === 'dashboard' || page === 'connectivity' || page === 'servers') && <>
                {editMode && canEditDashboard && <button className="edit-panel-button" type="button" onClick={() => setSectionDialog({
                  mode: 'create',
                  title: '',
                  kind: page === 'servers' ? 'servers' : 'icmp',
                  connectivity: page === 'connectivity',
                  fixedKind: page === 'connectivity' || page === 'servers',
                })}><Icon name="plus" size={15} />Nova seção</button>}
                {canEditDashboard && <button className={`edit-panel-button ${editMode ? 'is-editing' : ''}`} type="button" onClick={() => setEditMode((value) => !value)}>
                  <Icon name={editMode ? 'check' : 'edit'} size={15} />{editMode ? 'Concluir' : 'Editar painel'}
                </button>}
              </>}
              {!kioskMode && <button className="edit-panel-button" type="button" onClick={async () => {
                try {
                  await document.documentElement.requestFullscreen()
                  setKioskMode(true)
                } catch (requestError) {
                  console.error('Falha ao ativar a tela cheia:', requestError)
                  setConfigError('Não foi possível ativar a tela cheia. Verifique as permissões do navegador.')
                }
              }}>Modo apresentação</button>}
            </div>
          </section>

          {configError && (
            <div className="error-banner config-error" role="alert">
              <Icon name="alert" size={18} />
              <div><strong>Configuração do painel</strong><span>{configError}</span></div>
              <button type="button" onClick={() => setConfigError('')} aria-label="Fechar aviso"><Icon name="close" size={16} /></button>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" size={18} />
              <div><strong>Não foi possível carregar os dados</strong><span>{error}</span></div>
              <button type="button" onClick={() => loadDashboard()} aria-label="Tentar novamente"><Icon name="refresh" size={16} /></button>
            </div>
          )}
          {loading && !lastUpdated && !error && (
            <div className="loading-banner" role="status" aria-live="polite">
              <span className="loading-spinner" aria-hidden="true" />
              <div><strong>Aguardando conexão</strong><span>Conectando ao Zabbix e carregando os dados de monitoramento...</span></div>
            </div>
          )}

          {page === 'overview' && <>
            <section className="metrics-grid executive-metrics" aria-label="Resumo do monitoramento">
              <a href="#/connectivity"><MetricCard label="EQUIPAMENTOS MONITORADOS" value={dashboard.icmp.length + dashboard.servers.length} suffix="" detail={`${onlineCount} disponíveis · ${offlineHosts} indisponíveis · ${unknownHosts} sem dados`} icon="network" tone="blue" /></a>
              <a href="#/connectivity"><MetricCard label="LINKS DEGRADADOS" value={degradedLinks} suffix={` / ${dashboard.icmp.length}`} detail={`${offlineHosts} indisponíveis · ${onlineCount} disponíveis`} icon="activity" tone="amber" /></a>
              <a href="#/servers"><MetricCard label="DISCOS ≥ 80%" value={fullDisks.length} suffix="" detail={`${fullDisks.filter((disk) => Number(disk.used_pct) >= (config?.alertRules.diskCriticalPct || 90)).length} críticos`} icon="disk" tone={fullDisks.length ? 'amber' : 'green'} /></a>
              <a href="#/servers"><MetricCard label="CPU / MEMÓRIA ELEVADA" value={highCpuServers + highMemoryServers} suffix="" detail={`${highCpuServers} CPU · ${highMemoryServers} memória`} icon="cpu" tone={highCpuServers + highMemoryServers ? 'amber' : 'green'} /></a>
              <a href="#/alerts"><MetricCard label="ALERTAS CRÍTICOS" value={criticalAlerts} suffix="" detail="Ativos e não resolvidos" icon="alert" tone="amber" /></a>
              <a href="#/alerts"><MetricCard label="ALERTAS DE AVISO" value={warningAlerts} suffix="" detail="Ativos e não resolvidos" icon="alert" tone="violet" /></a>
              <a href="#/connectivity"><MetricCard label="LATÊNCIA MÉDIA" value={averageLatency === null ? '—' : formatNumber(averageLatency, 1)} suffix={averageLatency === null ? '' : ' ms'} detail="Links monitorados via ICMP" icon="activity" tone="violet" /></a>
              <a href="#/servers"><MetricCard label="CPU MÉDIA" value={averageCpu === null ? '—' : formatNumber(averageCpu)} suffix={averageCpu === null ? '' : '%'} detail={`${dashboard.servers.length} servidores monitorados`} icon="cpu" tone="green" /></a>
            </section>
            <section className="overview-columns">
              <div className="overview-panel">
                <div className="section-title-row"><div className="section-title"><span className="section-icon network-icon"><Icon name="alert" size={17} /></span><div><h2>Incidentes prioritários</h2><p>Alertas ativos ordenados por severidade</p></div></div><a className="text-link" href="#/alerts">Ver todos →</a></div>
                {activeAlerts.length ? <div className="priority-list">{[...activeAlerts].sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1)).slice(0, 5).map((alert) => <div className="priority-row" key={alert.id}><span className={`severity-dot ${alert.severity}`} /><div><strong>{alert.hostName}</strong><span>{alert.description}</span></div><time>{new Date(alert.startedAt).toLocaleTimeString('pt-BR')}</time></div>)}</div> : <EmptyState title="Nenhum alerta ativo" detail="As condições detectadas pelo sistema aparecerão aqui após persistirem pelo tempo configurado." />}
              </div>
              <div className="overview-panel">
                <div className="section-title-row"><div className="section-title"><span className="section-icon server-icon"><Icon name="clock" size={17} /></span><div><h2>Eventos recentes</h2><p>Alterações e recuperações automáticas</p></div></div><a className="text-link" href="#/alerts">Histórico →</a></div>
                {dashboard.alertEvents?.length ? <div className="priority-list">{[...dashboard.alertEvents].slice(-5).reverse().map((event) => <div className="priority-row" key={event.id}><span className="event-mark" /><div><strong>{alertEventLabel(event.action)}</strong><span>{event.message}</span></div><time>{new Date(event.at).toLocaleTimeString('pt-BR')}</time></div>)}</div> : <EmptyState title="Sem eventos recentes" detail="O histórico de alertas será exibido quando uma condição for detectada." />}
              </div>
            </section>
          </>}

          {page === 'dashboards' && (
            <section className="content-section">
              <div className="section-title-row"><div className="section-title"><span className="section-icon network-icon"><Icon name="dashboard" size={17} /></span><div><h2>Biblioteca de painéis</h2><p>Painéis independentes com endereço e configurações persistentes</p></div></div><span className="section-counter">{config?.dashboards.length || 0} painéis</span></div>
              <div className="dashboard-library">
                {config?.dashboards.map((item) => <article className="dashboard-tile" key={item.id}>
                  <div className="dashboard-tile-icon"><Icon name="dashboard" size={21} /></div>
                  <div className="dashboard-tile-copy"><span>{item.type === 'topology' ? 'Mapa · ' : item.type === 'network' ? 'Rede · ' : ''}{item.widgets.length} indicadores · {item.sections.length} seções{item.id === config.defaultDashboardId ? ' · Inicial' : ''}</span><h3>{item.title}</h3><small>Endereço: #/dashboard/{item.id}</small></div>
                  <div className="dashboard-tile-actions">
                    <a className="edit-panel-button" href={`#/dashboard/${item.id}`}>Abrir</a>
                    {isAdministrator && <>
                      <button className={`section-action ${item.favorite ? 'is-favorite' : ''}`} type="button" title={item.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} aria-label={item.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} aria-pressed={item.favorite} onClick={() => toggleFavorite(item)}>★</button>
                      <button className={`section-action ${item.id === config.defaultDashboardId ? 'is-favorite' : ''}`} type="button" title={item.id === config.defaultDashboardId ? 'Painel inicial' : 'Definir como painel inicial'} aria-label={item.id === config.defaultDashboardId ? 'Painel inicial selecionado' : 'Definir como painel inicial'} aria-pressed={item.id === config.defaultDashboardId} disabled={item.id === config.defaultDashboardId} onClick={() => setDefaultDashboard(item)}><Icon name="home" size={13} /></button>
                      <button className="section-action" type="button" aria-label="Renomear painel" onClick={() => renameDashboard(item)}><Icon name="edit" size={13} /></button>
                      <button className="section-action" type="button" aria-label="Duplicar painel" onClick={() => duplicateDashboard(item)}><Icon name="plus" size={13} /></button>
                      <button className="section-action section-delete" type="button" aria-label="Excluir painel" onClick={() => deleteDashboard(item)}><Icon name="trash" size={13} /></button>
                    </>}
                  </div>
                </article>)}
              </div>
            </section>
          )}

          {page === 'alerts' && (
            <section className="content-section">
              <div className="section-title-row"><div className="section-title"><span className="section-icon network-icon"><Icon name="alert" size={17} /></span><div><h2>Alertas e histórico</h2><p>Reconhecer não resolve o incidente; a resolução é automática após normalização.</p></div></div><span className="section-counter">{filteredAlerts.length} resultados</span></div>
              <div className="alert-filters">
                <label>Estado<select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value)}><option value="all">Todos</option><option value="active">Ativos</option><option value="acknowledged">Reconhecidos</option><option value="resolved">Resolvidos</option></select></label>
                <label>Severidade<select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">Todas</option><option value="critical">Crítica</option><option value="warning">Aviso</option></select></label>
                <label>Período<select value={alertPeriod} onChange={(event) => setAlertPeriod(event.target.value)}><option value="all">Todo o histórico</option><option value="1">Últimas 24 horas</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label>
              </div>
              {filteredAlerts.length ? <div className="alert-table-wrap"><table className="alert-table"><thead><tr><th>Severidade</th><th>Equipamento / Link</th><th>Problema</th><th>Valor / Limite</th><th>Início / última ocorrência</th><th>Estado</th><th>Ação</th></tr></thead><tbody>{filteredAlerts.map((alert) => <tr key={alert.id}>
                <td><span className={`severity-pill ${alert.severity}`}>{alert.severity === 'critical' ? 'Crítica' : 'Aviso'}</span></td>
                <td>{alert.hostName}</td><td>{alert.description}</td><td>{alert.value === null ? '—' : `${formatNumber(alert.value, 2)} / ${formatNumber(alert.threshold, 2)}`}</td>
                <td>{new Date(alert.startedAt).toLocaleString('pt-BR')}<small>{new Date(alert.lastOccurrence).toLocaleString('pt-BR')}</small></td>
                <td><span className={`alert-status ${alert.status}`}>{alert.status === 'active' ? 'Ativo' : alert.status === 'acknowledged' ? 'Reconhecido' : 'Resolvido'}</span></td>
                <td>{alert.status === 'active' && <button className="edit-panel-button" type="button" onClick={() => acknowledgeAlert(alert)}>Reconhecer</button>}</td>
              </tr>)}</tbody></table></div> : <EmptyState title="Nenhum alerta neste filtro" detail="Ajuste os filtros ou aguarde a próxima avaliação das métricas." />}
              <div className="overview-panel alert-events-panel"><h2>Histórico de alterações</h2>{dashboard.alertEvents?.length ? [...dashboard.alertEvents].slice(-50).reverse().map((event) => <div className="event-line" key={event.id}><span>{new Date(event.at).toLocaleString('pt-BR')}</span><strong>{alertEventLabel(event.action)}</strong><span>{event.message}</span></div>) : <p className="empty-inline">Ainda não há eventos de alerta registrados.</p>}</div>
            </section>
          )}

          {page === 'users' && isAdministrator && config && <UserAdministration dashboards={config.dashboards} currentUser={authUser} />}

          {page === 'settings' && config && (
            <section className="content-section settings-grid">
              <div className="settings-panel"><h2>Atualização dos dados</h2><p>A consulta periódica dos dados é independente da rotação entre painéis.</p>
                <label className="settings-toggle"><span>Atualização automática</span><input type="checkbox" checked={config.preferences.autoRefresh} onChange={(event) => updatePreference('autoRefresh', event.target.checked)} /></label>
                <label className="settings-field"><span>Intervalo</span><select value={[5, 10, 15, 30, 60, 300].includes(config.preferences.refreshSeconds) ? config.preferences.refreshSeconds : 'custom'} onChange={(event) => updatePreference('refreshSeconds', event.target.value === 'custom' ? 45 : Number(event.target.value))}><option value={5}>5 segundos</option><option value={10}>10 segundos</option><option value={15}>15 segundos</option><option value={30}>30 segundos</option><option value={60}>1 minuto</option><option value={300}>5 minutos</option><option value="custom">Personalizado</option></select></label>
                {![5, 10, 15, 30, 60, 300].includes(config.preferences.refreshSeconds) && <label className="settings-field"><span>Intervalo personalizado (segundos)</span><input type="number" min="5" max="3600" value={config.preferences.refreshSeconds} onChange={(event) => updatePreference('refreshSeconds', Number(event.target.value))} /></label>}
                <label className="settings-field"><span>Painel inicial</span><select value={config.defaultDashboardId} onChange={(event) => setConfig((current) => ({ ...current, defaultDashboardId: event.target.value }))}>{config.dashboards.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                <label className="settings-field"><span>Aparência</span><select value={config.preferences.theme} onChange={(event) => updatePreference('theme', event.target.value)}><option value="dark">Escuro</option><option value="light">Claro</option><option value="high-contrast">Alto contraste</option></select></label>
              </div>
              <div className="settings-panel"><h2>Detecção de alertas</h2><p>Alertas só abrem após a condição persistir pelo tempo mínimo.</p>
                {[['minDurationSeconds', 'Persistência mínima (segundos)'], ['staleSeconds', 'Coleta considerada ausente (segundos)'], ['diskWarningPct', 'Aviso de disco (%)'], ['diskCriticalPct', 'Crítico de disco (%)'], ['packetLossPct', 'Perda de pacotes (%)'], ['latencyWarningMs', 'Aviso de latência (ms)'], ['latencyCriticalMs', 'Crítico de latência (ms)'], ['cpuPct', 'CPU elevada (%)'], ['memoryPct', 'Memória elevada (%)'], ['recurrenceSeconds', 'Intervalo de recorrência (segundos)']].map(([key, label]) => <label className="settings-field" key={key}><span>{label}</span><input type="number" min="0" max="86400" value={config.alertRules[key]} onChange={(event) => updateAlertRule(key, event.target.value)} /></label>)}
              </div>
              <div className="settings-panel"><h2>Modo apresentação para TV</h2><p>Configure os painéis e o tempo de exibição de cada tela. Use o botão Modo apresentação para ativar a tela cheia.</p>
                <label className="settings-toggle"><span>Alternância automática entre painéis</span><input type="checkbox" checked={config.preferences.kiosk.rotationEnabled} onChange={(event) => updatePreference('kiosk', { ...config.preferences.kiosk, rotationEnabled: event.target.checked })} /></label>
                <label className="settings-field"><span>Tempo por painel (segundos)</span><input type="number" min="5" max="3600" value={config.preferences.kiosk.secondsPerDashboard} onChange={(event) => updatePreference('kiosk', { ...config.preferences.kiosk, secondsPerDashboard: Number(event.target.value) })} /></label>
                <div className="kiosk-dashboard-list">{config.dashboards.map((item) => <label key={item.id}><input type="checkbox" checked={config.preferences.kiosk.dashboardIds.includes(item.id)} onChange={(event) => {
                  const currentIds = config.preferences.kiosk.dashboardIds
                  updatePreference('kiosk', { ...config.preferences.kiosk, dashboardIds: event.target.checked ? [...currentIds, item.id] : currentIds.filter((id) => id !== item.id) })
                }} />{item.title}</label>)}</div>
              </div>
            </section>
          )}

          {page === 'dashboard' && layout.widgets.some((widget) => !widget.sectionId) && (
            <section
              className={`custom-widget-grid ${layout.type === 'topology' ? 'topology-map' : ''}`}
              aria-label={layout.type === 'topology' ? 'Mapa personalizável de rede' : 'Indicadores personalizados'}
              style={layout.type === 'topology' ? { height: `${mapCanvasHeight}px` } : undefined}
            >
              {layout.widgets.filter((widget) => !widget.sectionId).map((widget, index) => {
                const isTopology = layout.type === 'topology'
                const isMapHost = isTopology && widget.type === 'availability'
                const mapSize = widget.mapSizePx || 80
                const mapCols = widget.mapCols || 4
                const mapRows = widget.mapRows || 4
                const mapPosition = mapPositions.find((item) => item.id === widget.id)
                const wrapperClass = isTopology
                  ? `custom-widget-wrap topology-widget-wrap ${isMapHost ? 'topology-host-wrap' : 'topology-chart-wrap'}`
                  : `custom-widget-wrap widget-width-${widget.width || 1}`
                return (
                  <div
                    className={wrapperClass}
                    style={isTopology ? {
                      '--map-size': `${mapSize}px`,
                      left: `${mapPosition.mapX}px`,
                      top: `${mapPosition.mapY}px`,
                      width: `${mapPosition.width}px`,
                      height: `${mapPosition.height}px`,
                    } : { '--widget-height': widget.height || (widget.type === 'timeseries' ? 2 : 1) }}
                    key={widget.id}
                    draggable={!isTopology && canEditDashboard}
                    onDragStart={!isTopology && canEditDashboard ? (event) => event.dataTransfer.setData('text/plain', widget.id) : undefined}
                    onDragOver={!isTopology && canEditDashboard ? (event) => event.preventDefault() : undefined}
                    onDrop={!isTopology && canEditDashboard ? (event) => {
                      event.preventDefault()
                      const draggedId = event.dataTransfer.getData('text/plain')
                      const fromIndex = layout.widgets.findIndex((item) => item.id === draggedId)
                      const toIndex = layout.widgets.findIndex((item) => item.id === widget.id)
                      if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
                        const reordered = [...layout.widgets]
                        const [dragged] = reordered.splice(fromIndex, 1)
                        reordered.splice(toIndex, 0, dragged)
                        setLayout((current) => ({ ...current, widgets: reordered }))
                      }
                    } : undefined}
                  >
                    <MetricWidget widget={{ ...widget, dashboardType: layout.type }} data={widgetHistories} />
                    {canEditDashboard && isTopology && <button className="map-drag-handle" type="button" onPointerDown={(event) => moveMapWidgetByPixels(event, widget)} aria-label={`Arraste ${widget.title} para qualquer posição`} title="Arraste para mover livremente"><Icon name="grip" size={14} /></button>}
                    {canEditDashboard && <div className={`widget-controls ${isAdministrator ? '' : 'moderator-controls'}`} role="group" aria-label={`Controles de ${widget.title}`}>
                      {isAdministrator && <><button type="button" onClick={() => configureWidget(widget)} aria-label={`Configurar ${widget.title}`} title="Configurar"><Icon name="edit" size={13} /></button><span className="widget-control-divider" /></>}
                      {!isTopology && <><button type="button" onClick={() => moveWidget(widget.id, -1)} disabled={index === 0} aria-label={`Mover ${widget.title} para esquerda`} title="Mover para esquerda"><Icon name="chevron" size={14} className="chevron-left" /></button>
                      <button type="button" onClick={() => moveWidget(widget.id, 1)} disabled={index === layout.widgets.filter((item) => !item.sectionId).length - 1} aria-label={`Mover ${widget.title} para direita`} title="Mover para direita"><Icon name="chevron" size={14} /></button></>}
                      {isAdministrator && <><span className="widget-control-divider" />
                        <button type="button" onClick={() => resizeWidget(widget.id, -1)} disabled={isTopology ? isMapHost ? mapSize <= 56 : mapCols <= 2 && mapRows <= 4 : (widget.width || 1) <= 1} aria-label={`Reduzir tamanho de ${widget.title}`} title={isMapHost ? 'Diminuir bloco' : 'Diminuir tamanho'}>−</button>
                        <button type="button" onClick={() => resizeWidget(widget.id, 1)} disabled={isTopology ? isMapHost ? mapSize >= 480 : mapCols >= 24 && mapRows >= 24 : (widget.width || 1) >= 4} aria-label={`Aumentar tamanho de ${widget.title}`} title={isMapHost ? 'Aumentar bloco' : 'Aumentar tamanho'}>+</button>
                        <button type="button" className="widget-remove-button" onClick={() => setConfirmation({
                          title: 'Excluir indicador?',
                          message: `O indicador "${widget.title}" será removido deste painel. Esta ação não pode ser desfeita.`,
                          onConfirm: () => setLayout((current) => ({ ...current, widgets: current.widgets.filter((item) => item.id !== widget.id) })),
                        })} aria-label={`Remover ${widget.title}`} title="Remover"><Icon name="close" size={13} /></button>
                      </>}
                    </div>}
                    {isAdministrator && isTopology && widget.type === 'timeseries' && <button className="widget-resize-handle" type="button" onPointerDown={(event) => resizeMapWidgetByDrag(event, widget)} aria-label={`Arraste para redimensionar ${widget.title}`} title="Arraste para redimensionar"><Icon name="grip" size={14} /></button>}
                    {isAdministrator && !isTopology && <button className="widget-resize-handle" type="button" onPointerDown={(event) => resizeWidgetByDrag(event, widget)} aria-label={`Arraste para redimensionar ${widget.title}`} title="Arraste para redimensionar"><Icon name="grip" size={14} /></button>}
                  </div>
                )
              })}
            </section>
          )}

          {page === 'dashboard' && layout.sections.length === 0 && layout.widgets.length === 0 && (
            <section className="blank-dashboard" aria-label="Painel vazio">
              <span className="blank-dashboard-icon"><Icon name="dashboard" size={23} /></span>
              <h2>Seu painel está vazio</h2>
              <p>{layout.type === 'topology' ? 'Adicione hosts e gráficos. Depois, arraste pela alça para posicionar cada item pixel a pixel.' : 'Adicione as seções e os indicadores que deseja acompanhar.'}</p>
              <div>
                {layout.type !== 'topology' && <button className="edit-panel-button" type="button" onClick={() => setSectionDialog({ mode: 'create', title: '', kind: 'icmp' })}><Icon name="plus" size={15} />Adicionar seção</button>}
                <button className="edit-panel-button" type="button" onClick={() => setWidgetDialog({})}><Icon name="plus" size={15} />{layout.type === 'topology' ? 'Adicionar host ou gráfico' : 'Adicionar indicador'}</button>
              </div>
            </section>
          )}

          {page === 'connectivity' && activeLayout.sections.length === 0 && (
            <section className="blank-dashboard" aria-label="Conectividade vazia">
              <span className="blank-dashboard-icon"><Icon name="network" size={23} /></span>
              <h2>Conectividade começando do zero</h2>
              <p>Crie uma seção e adicione somente os equipamentos que deseja acompanhar.</p>
              {canEditDashboard && <button className="edit-panel-button" type="button" onClick={() => setSectionDialog({ mode: 'create', title: '', kind: 'icmp', connectivity: true, fixedKind: true })}><Icon name="plus" size={15} />Criar primeira seção</button>}
            </section>
          )}

          {(page === 'overview' || page === 'dashboard' || page === 'connectivity' || page === 'servers') && (
            page === 'connectivity'
              ? activeLayout.sections
              : page === 'servers'
                ? (activeLayout.sections.length
                  ? activeLayout.sections
                  : [{ id: '__all_servers__', title: 'Servidores', kind: 'servers' }])
                : layout.sections
          ).map((section) => {
            const isConsumptionSection = page === 'dashboard' && section.kind === 'consumption'
            const sectionWidgets = isConsumptionSection ? layout.widgets.filter((widget) => widget.sectionId === section.id) : []
            const sectionCards = page === 'servers' && section.id === '__all_servers__'
              ? orderVisible(dashboard.servers, activeLayout.orderServers, activeLayout.hiddenServers)
                .filter((server) => server.host_name.toLowerCase().includes(search.toLowerCase()))
              : cardsForSection(section)
            const isIcmp = section.kind === 'icmp'
            const isVirtualServerSection = section.id === '__all_servers__'
            const sectionIcon = isConsumptionSection ? 'activity' : isIcmp ? 'network' : 'server'
            const sectionCountLabel = isConsumptionSection ? 'indicadores' : isIcmp ? 'sistemas' : 'hosts'
            const cardEmptyTitle = loading
              ? (isIcmp ? 'Conectando ao Zabbix...' : 'Carregando servidores...')
              : search
                ? 'Nenhum host encontrado'
                : 'Seção sem cards'
            const cardEmptyDetail = loading
              ? 'Os indicadores aparecerão assim que os dados forem carregados.'
              : search
                ? 'Tente outro nome de host.'
                : 'Ative a edição do painel e adicione ou mova cards para esta seção.'

            return (
              <section className="content-section" id={section.id} key={section.id}>
                <div className="section-title-row">
                  <div className="section-title">
                    <span className={`section-icon ${isConsumptionSection ? 'consumption-icon' : isIcmp ? 'network-icon' : 'server-icon'}`}><Icon name={sectionIcon} size={17} /></span>
                    <div><h2>{section.title}</h2><p>{isConsumptionSection ? 'Tráfego, volume e consumo ao longo do tempo' : isIcmp ? 'Disponibilidade, latência e perda de pacotes' : 'Uso de CPU, memória e armazenamento'}</p></div>
                  </div>
                  <div className="section-actions">
                    <span className="section-counter">{isConsumptionSection ? sectionWidgets.length : sectionCards.length} {sectionCountLabel}</span>
                    {editMode && canEditDashboard && isConsumptionSection && <button className="edit-panel-button consumption-add-button" type="button" onClick={() => setWidgetDialog({ sectionId: section.id })}><Icon name="plus" size={14} />Adicionar métrica</button>}
                    {editMode && isAdministrator && !isVirtualServerSection && <>
                      <button className="section-action" type="button" aria-label={`Renomear ${section.title}`} onClick={() => setSectionDialog({ mode: 'rename', id: section.id, title: section.title, kind: section.kind })}><Icon name="edit" size={13} /></button>
                      <button className="section-action section-delete" type="button" aria-label={`Excluir ${section.title}`} onClick={() => handleDeleteSection(section)}><Icon name="trash" size={13} /></button>
                    </>}
                  </div>
                </div>
                {editMode && !isVirtualServerSection && !isConsumptionSection && (
                  <div className="layout-toolbar">
                    <span><Icon name="grip" size={15} />Arraste para organizar; use a alça no canto do card para redimensionar</span>
                    <HostPicker hosts={availableForSection(section)} onAdd={(name) => handleAddCard(section, name)} />
                  </div>
                )}
                {isConsumptionSection ? (
                  sectionWidgets.length ? (
                    <div className="custom-widget-grid consumption-widget-grid">
                      {sectionWidgets.map((widget, index) => (
                        <div className={`custom-widget-wrap widget-width-${widget.width || 1}`} style={{ '--widget-height': widget.height || 2 }} key={widget.id}>
                          <MetricWidget widget={{ ...widget, dashboardType: layout.type }} data={widgetHistories} />
                          {canEditDashboard && <div className={`widget-controls ${isAdministrator ? '' : 'moderator-controls'}`} role="group" aria-label={`Controles de ${widget.title}`}>
                            {isAdministrator && <><button type="button" onClick={() => configureWidget(widget)} aria-label={`Configurar ${widget.title}`} title="Configurar"><Icon name="edit" size={13} /></button><span className="widget-control-divider" /></>}
                            <button type="button" onClick={() => moveWidget(widget.id, -1)} disabled={index === 0} aria-label={`Mover ${widget.title} para esquerda`} title="Mover para esquerda"><Icon name="chevron" size={14} className="chevron-left" /></button>
                            <button type="button" onClick={() => moveWidget(widget.id, 1)} disabled={index === sectionWidgets.length - 1} aria-label={`Mover ${widget.title} para direita`} title="Mover para direita"><Icon name="chevron" size={14} /></button>
                            {isAdministrator && <><span className="widget-control-divider" /><button type="button" className="widget-remove-button" onClick={() => setConfirmation({
                              title: 'Excluir indicador?',
                              message: `O indicador "${widget.title}" será removido deste painel. Esta ação não pode ser desfeita.`,
                              onConfirm: () => setLayout((current) => ({ ...current, widgets: current.widgets.filter((item) => item.id !== widget.id) })),
                            })} aria-label={`Remover ${widget.title}`} title="Remover"><Icon name="close" size={13} /></button></>}
                          </div>}
                          {isAdministrator && <button className="widget-resize-handle" type="button" onPointerDown={(event) => resizeWidgetByDrag(event, widget)} aria-label={`Arraste para redimensionar ${widget.title}`} title="Arraste para redimensionar"><Icon name="grip" size={14} /></button>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="consumption-empty">
                      <span className="consumption-empty-mark"><Icon name="activity" size={19} /></span>
                      <div><strong>Nenhum indicador de consumo</strong><span>Adicione um item numérico do Zabbix e escolha o período que deseja acompanhar.</span></div>
                      {editMode && canEditDashboard && <button className="edit-panel-button" type="button" onClick={() => setWidgetDialog({ sectionId: section.id })}><Icon name="plus" size={14} />Adicionar métrica</button>}
                    </div>
                  )
                ) : sectionCards.length ? (
                  <div
                    className={`${isIcmp ? 'icmp-grid' : 'server-grid'} ${editMode ? 'grid-editing' : ''}`}
                    onDragOver={(event) => { if (editMode) event.preventDefault() }}
                    onDrop={(event) => handleDrop(event, section, null)}
                  >
                    {sectionCards.map((item) => (
                      isIcmp
                        ? <IcmpCard key={item.host_name} host={item} size={activeLayout.cardSizes[`icmp:${item.host_name}`]} onResize={resizeHostCardByDrag} editMode={editMode} canDelete={isAdministrator} onRemove={handleRemoveCard} onDragStart={(event, _kind, name) => handleDragStart(event, section, name)} onDragOver={(event) => { if (editMode) event.preventDefault() }} onDrop={(event, _kind, name) => handleDrop(event, section, name)} />
                        : <ServerCard key={item.host_name} server={item} size={activeLayout.cardSizes[`servers:${item.host_name}`]} onResize={resizeHostCardByDrag} editMode={editMode} canDelete={isAdministrator} onRemove={handleRemoveCard} onDragStart={(event, _kind, name) => handleDragStart(event, section, name)} onDragOver={(event) => { if (editMode) event.preventDefault() }} onDrop={(event, _kind, name) => handleDrop(event, section, name)} />
                    ))}
                  </div>
                ) : (
                  <EmptyState title={cardEmptyTitle} detail={cardEmptyDetail} />
                )}
              </section>
            )
          })}

          <footer className="page-footer"><span>NTIBIX <i>·</i> MONITORAMENTO E OBSERVABILIDADE</span><span>Dados fornecidos pelo Zabbix <span className="footer-live" /></span></footer>
        </div>
      </main>
      {saveNotice && (
        <div className={`save-toast ${saveNotice.type}`} role={saveNotice.type === 'error' ? 'alert' : 'status'} aria-live="polite">
          {saveNotice.type === 'saving'
            ? <span className="loading-spinner" aria-hidden="true" />
            : <Icon name={saveNotice.type === 'success' ? 'check' : 'alert'} size={17} />}
          <strong>{saveNotice.message}</strong>
          {saveNotice.type !== 'saving' && <button type="button" onClick={() => setSaveNotice(null)} aria-label="Fechar notificação"><Icon name="close" size={14} /></button>}
        </div>
      )}
      {sectionDialog && <SectionDialog dialog={sectionDialog} onClose={() => setSectionDialog(null)} onSave={handleSaveSection} />}
      {dashboardCreateOpen && <DashboardCreateDialog onClose={() => setDashboardCreateOpen(false)} onCreate={createDashboard} />}
      {widgetDialog && <WidgetDialog onClose={() => setWidgetDialog(null)} onSave={saveWidget} widget={widgetDialog.id ? widgetDialog : null} sectionId={widgetDialog.sectionId} dashboardType={layout.type || 'general'} />}
      {confirmation && <ConfirmDialog title={confirmation.title} message={confirmation.message} onCancel={() => setConfirmation(null)} onConfirm={() => {
        const action = confirmation.onConfirm
        setConfirmation(null)
        action()
      }} />}
    </div>
  )
}

export default App
