const bitRateUnits = new Set(['bps', 'bit/s', 'bits/s'])
const byteRateUnits = new Set(['Bps', 'B/s', 'byte/s', 'bytes/s'])
const byteCounterUnits = new Set(['B', 'byte', 'bytes'])

export function isSupportedTrafficUnit(unit) {
  const compactUnit = typeof unit === 'string' ? unit.trim().replace(/\s+/g, '') : ''
  return bitRateUnits.has(compactUnit) || byteRateUnits.has(compactUnit) || byteCounterUnits.has(compactUnit)
}

export function connectionTrafficMbps(points, unit) {
  const compactUnit = typeof unit === 'string' ? unit.trim().replace(/\s+/g, '') : ''
  const validPoints = (Array.isArray(points) ? points : [])
    .filter((point) => point
      && point.value !== null
      && point.value !== undefined
      && point.value !== '')
    .map((point) => ({ time: Date.parse(point.time), value: Number(point.value) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .sort((first, second) => first.time - second.time)

  if (bitRateUnits.has(compactUnit)) {
    const latest = validPoints.at(-1)?.value
    return latest === undefined ? null : latest / 1_000_000
  }
  if (byteRateUnits.has(compactUnit)) {
    const latest = validPoints.at(-1)?.value
    return latest === undefined ? null : (latest * 8) / 1_000_000
  }
  if (!byteCounterUnits.has(compactUnit)) return null

  for (let index = validPoints.length - 1; index > 0; index -= 1) {
    const current = validPoints[index]
    const previous = validPoints[index - 1]
    const seconds = (current.time - previous.time) / 1000
    const bytes = current.value - previous.value
    if (seconds > 0 && bytes >= 0) return (bytes * 8) / seconds / 1_000_000
  }
  return null
}
