const STALE_AFTER_SECONDS = 180
const FLAP_WINDOW_SECONDS = 300
const FLAP_TRANSITIONS = 3
const RECOVERY_SECONDS = 30

export function getAvailabilityStatus(points, now = Date.now()) {
  const samples = (Array.isArray(points) ? points : [])
    .map((point) => ({ value: Number(point.value), time: Date.parse(point.time) }))
    .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time)

  const latest = samples.at(-1)
  if (!latest || now - latest.time > STALE_AFTER_SECONDS * 1000) {
    return { state: 'unknown', label: 'SEM DADOS' }
  }
  if (latest.value === 0) return { state: 'down', label: 'DOWN' }
  if (latest.value !== 1) return { state: 'unknown', label: 'VALOR INVÁLIDO' }

  const windowStart = now - FLAP_WINDOW_SECONDS * 1000
  let previousValue
  let transitions = 0
  let lastTransition = null
  for (const sample of samples) {
    if (sample.time < windowStart) {
      previousValue = sample.value
      continue
    }
    if (previousValue !== undefined && sample.value !== previousValue) {
      transitions += 1
      lastTransition = sample
    }
    previousValue = sample.value
  }

  if (transitions >= FLAP_TRANSITIONS) return { state: 'flapping', label: 'OSCILANDO' }
  if (lastTransition?.value === 1 && now - lastTransition.time < RECOVERY_SECONDS * 1000) {
    return { state: 'recovering', label: 'RECUPERANDO' }
  }
  return { state: 'up', label: 'UP' }
}
