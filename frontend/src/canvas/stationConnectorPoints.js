export function normalizeConnectorPoints(points) {
  if (!Array.isArray(points)) return [{ x: 0, y: 0 }, { x: 160, y: 0 }]
  const normalized = points
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
  return normalized.length >= 2 ? normalized : [{ x: 0, y: 0 }, { x: 160, y: 0 }]
}

export function insertConnectorPoint(points, segmentIndex, point) {
  const next = normalizeConnectorPoints(points)
  const index = Math.max(0, Math.min(next.length - 2, Number(segmentIndex) || 0))
  const inserted = {
    x: Number.isFinite(point?.x) ? Number(point.x) : 0,
    y: Number.isFinite(point?.y) ? Number(point.y) : 0,
  }
  next.splice(index + 1, 0, inserted)
  return next
}

export function moveConnectorPoint(points, pointIndex, point) {
  const next = normalizeConnectorPoints(points)
  const index = Number(pointIndex)
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next
  next[index] = {
    x: Number.isFinite(point?.x) ? Number(point.x) : next[index].x,
    y: Number.isFinite(point?.y) ? Number(point.y) : next[index].y,
  }
  return next
}

export function connectorMidpoint(a, b) {
  return {
    x: (Number(a?.x) + Number(b?.x)) / 2,
    y: (Number(a?.y) + Number(b?.y)) / 2,
  }
}
