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

export function resolveMapPositions(widgets) {
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

export function resolveLayoutMapPositions(layout) {
  const topologySectionIds = new Set(layout.sections
    .filter((section) => section.kind === 'topology')
    .map((section) => section.id))
  const mapGroups = new Map()
  for (const widget of layout.widgets) {
    const isMapWidget = (layout.type === 'topology' && !widget.sectionId)
      || (widget.sectionId && topologySectionIds.has(widget.sectionId))
    if (!isMapWidget) continue
    const groupId = widget.sectionId || ''
    const group = mapGroups.get(groupId) || []
    group.push(widget)
    mapGroups.set(groupId, group)
  }
  const positions = new Map()
  for (const widgets of mapGroups.values()) {
    for (const widget of resolveMapPositions(widgets)) {
      positions.set(widget.id, { mapX: widget.mapX, mapY: widget.mapY })
    }
  }
  return layout.widgets.map((widget) => {
    const position = positions.get(widget.id)
    return position ? { ...widget, ...position } : widget
  })
}
