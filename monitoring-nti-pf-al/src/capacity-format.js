export function capacityInDisplayUnit(valueInGib) {
  if (valueInGib === null || valueInGib === undefined || valueInGib === '') return null
  const value = Number(valueInGib)
  if (!Number.isFinite(value) || value < 0) return null
  if (value < 1) return { value: value * 1024, unit: 'MB' }
  if (value < 1024) return { value, unit: 'GB' }
  return { value: value / 1024, unit: 'TB' }
}
