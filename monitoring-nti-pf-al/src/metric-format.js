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
