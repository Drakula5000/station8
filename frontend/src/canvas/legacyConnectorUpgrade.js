import { getIndices } from 'tldraw'

function richTextPlainText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return String(node.text || '')
  return (node.content || []).map(richTextPlainText).join('')
}

function isSimpleLegacyArrow(shape) {
  const props = shape?.props || {}
  if (shape?.typeName !== 'shape' || shape?.type !== 'arrow') return false
  if (props.kind && props.kind !== 'arc') return false
  if (Math.abs(Number(props.scale || 1) - 1) > 0.0001) return false
  if (richTextPlainText(props.richText).trim()) return false
  return true
}

export function connectorPointMap(points) {
  const normalized = (points || [])
    .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    .map(point => ({ x: Number(point.x), y: Number(point.y) }))
  if (normalized.length < 2) return null

  const ids = getIndices(normalized.length)
  return Object.fromEntries(normalized.map((point, index) => {
    const id = ids[index]
    return [id, { id, index: id, x: point.x, y: point.y }]
  }))
}

// Station connectors saved by the first implementation stored points as an
// array. Convert them to LineShapeUtil's native indexed point map before the
// snapshot enters tldraw's store validator.
export function migrateStoredStationConnectors(snapshot) {
  const store = snapshot?.store
  if (!store || typeof store !== 'object') return snapshot

  let changed = false
  const nextStore = { ...store }
  for (const [key, record] of Object.entries(store)) {
    if (record?.typeName !== 'shape' || record?.type !== 's8-connector') continue
    if (!Array.isArray(record.props?.points)) continue

    const points = connectorPointMap(record.props.points)
    if (!points) continue
    nextStore[key] = {
      ...record,
      props: {
        ...record.props,
        points,
        spline: record.props?.spline || 'cubic',
        scale: Number.isFinite(record.props?.scale) ? record.props.scale : 1,
      },
    }
    changed = true
  }

  return changed ? { ...snapshot, store: nextStore } : snapshot
}

export function connectorPointsFromArrowInfo(info) {
  if (!info || !info.start?.point || !info.end?.point || info.type === 'elbow') return null
  const points = info.type === 'arc'
    ? [info.start.point, info.middle, info.end.point]
    : [info.start.point, info.end.point]
  if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null
  return points.map(point => ({ x: Number(point.x), y: Number(point.y) }))
}

// Upgrade after the native snapshot is loaded so tldraw resolves bound arrow
// endpoints first. The replacement preserves the visible geometry but uses the
// native Line point map, so it gets native midpoint interaction immediately.
export function upgradeLoadedLegacyConnectors(editor, { getArrowInfo, createShapeId }) {
  if (!editor || typeof getArrowInfo !== 'function' || typeof createShapeId !== 'function') return 0
  const arrows = editor.getCurrentPageShapes().filter(isSimpleLegacyArrow)
  let upgraded = 0

  for (const arrow of arrows) {
    let info
    try {
      info = getArrowInfo(editor, arrow)
    } catch {
      continue
    }

    const points = connectorPointMap(connectorPointsFromArrowInfo(info))
    if (!points) continue

    const replacement = {
      id: createShapeId(),
      type: 's8-connector',
      x: arrow.x,
      y: arrow.y,
      rotation: arrow.rotation,
      parentId: arrow.parentId,
      index: arrow.index,
      opacity: arrow.opacity,
      isLocked: arrow.isLocked,
      meta: {
        ...(arrow.meta || {}),
        upgradedFromNativeConnector: true,
        legacyConnectorId: arrow.id,
      },
      props: {
        points,
        spline: 'cubic',
        scale: 1,
        color: arrow.props?.color || 'black',
        dash: arrow.props?.dash || 'draw',
        size: arrow.props?.size || 'm',
        arrowheadStart: arrow.props?.arrowheadStart || 'none',
        arrowheadEnd: arrow.props?.arrowheadEnd || 'arrow',
      },
    }

    editor.deleteShapes([arrow.id])
    editor.createShape(replacement)
    upgraded += 1
  }

  return upgraded
}
