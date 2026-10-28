function sizeOf(node, dimension) {
  return node[dimension] || node.measured?.[dimension] || node.style?.[dimension] || 0
}

function nearestAlignment(position, size, otherPosition, otherSize, threshold) {
  const movingAnchors = [0, size / 2, size]
  const targetAnchors = [0, otherSize / 2, otherSize]
  let best = null
  for (const moving of movingAnchors) {
    for (const target of targetAnchors) {
      const targetCoordinate = otherPosition + target
      const delta = targetCoordinate - (position + moving)
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, coordinate: targetCoordinate }
      }
    }
  }
  return best
}

export function getSnappedNodePosition(node, position, otherNodes, threshold = 8) {
  let xAlignment = null
  let yAlignment = null
  for (const other of otherNodes) {
    if (other.id === node.id) continue
    const horizontal = nearestAlignment(
      position.x,
      sizeOf(node, 'width'),
      other.position.x,
      sizeOf(other, 'width'),
      threshold,
    )
    const vertical = nearestAlignment(
      position.y,
      sizeOf(node, 'height'),
      other.position.y,
      sizeOf(other, 'height'),
      threshold,
    )
    if (horizontal && (!xAlignment || Math.abs(horizontal.delta) < Math.abs(xAlignment.delta))) {
      xAlignment = horizontal
    }
    if (vertical && (!yAlignment || Math.abs(vertical.delta) < Math.abs(yAlignment.delta))) {
      yAlignment = vertical
    }
  }

  return {
    position: {
      x: position.x + (xAlignment?.delta || 0),
      y: position.y + (yAlignment?.delta || 0),
    },
    guides: {
      x: xAlignment?.coordinate ?? null,
      y: yAlignment?.coordinate ?? null,
    },
  }
}
