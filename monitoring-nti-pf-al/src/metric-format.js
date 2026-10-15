export function formatMetricSeries(values, originalUnit = '') {
  const unit = originalUnit.trim()
  const maxValue = Math.max(0, ...values.map((value) => Math.abs(value)))
  const compactUnit = unit.replace(/\s+/g, '')
  let divisor = 1
  let displayedUnit = unit

  if (/^(bps|bit\/s|bits\/s)$/.test(compactUnit)) {
    const labels = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps']
    let scale = 0
    while (maxValue / divisor >= 1000 && scale < labels.length - 1) {
      divisor *= 1000
      scale += 1
    }
    displayedUnit = labels[scale]
  } else if (/^(Bps|B\/s|byte\/s|bytes\/s)$/.test(compactUnit)) {
    const labels = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']
    let scale = 0
    while (maxValue / divisor >= 1024 && scale < labels.length - 1) {
      divisor *= 1024
      scale += 1
    }
    displayedUnit = labels[scale]
  } else if (/^(B|byte|bytes)$/i.test(unit)) {
    const labels = ['B', 'KB', 'MB', 'GB', 'TB']
    let scale = 0
    while (maxValue / divisor >= 1024 && scale < labels.length - 1) {
      divisor *= 1024
      scale += 1
    }
    displayedUnit = labels[scale]
  } else if (/^(s|sec|second|seconds)$/i.test(unit)) {
    if (maxValue > 0 && maxValue < 1) {
      divisor = 0.001
      displayedUnit = 'ms'
    } else if (maxValue >= 86400) {
      divisor = 86400
      displayedUnit = 'd'
    } else if (maxValue >= 3600) {
      divisor = 3600
      displayedUnit = 'h'
    } else if (maxValue >= 60) {
      divisor = 60
      displayedUnit = 'min'
    } else {
      displayedUnit = 's'
    }
  }

  return { values: values.map((value) => value / divisor), unit: displayedUnit }
}

export function formatMetricSeriesGroups(series) {
  const groups = new Map()
  series.forEach((item, index) => {
    const key = item.originalUnit.trim()
    if (!groups.has(key)) {
      groups.set(key, {
        id: `y${groups.size}`,
        originalUnit: item.originalUnit,
        values: [],
        indexes: [],
      })
    }
    const group = groups.get(key)
    group.values.push(...item.rawValues)
    group.indexes.push(index)
  })

  for (const group of groups.values()) {
    group.formatted = formatMetricSeries(group.values, group.originalUnit)
  }

  return {
    series: series.map((item, index) => {
      const group = groups.get(item.originalUnit.trim())
      const groupIndex = group.indexes.indexOf(index)
      const valueOffset = group.indexes
        .slice(0, groupIndex)
        .reduce((offset, seriesIndex) => offset + series[seriesIndex].rawValues.length, 0)
      return {
        ...item,
        axisId: group.id,
        unit: group.formatted.unit,
        values: group.formatted.values.slice(valueOffset, valueOffset + item.rawValues.length),
      }
    }),
    axes: [...groups.values()].map((group) => ({
      id: group.id,
      originalUnit: group.originalUnit,
      unit: group.formatted.unit,
    })),
  }
}
