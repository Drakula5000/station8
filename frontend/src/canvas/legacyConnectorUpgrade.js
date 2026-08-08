import { getIndices } from 'tldraw'

function richTextPlainText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return String(node.text || '')
  return (node.content || []).map(richTextPlainText).join('')
}

function hasVisibleArrowLabel(shape) {
  // Old tldraw snapshots can contain zero-width formatting characters even
  // when the arrow has no visible label. Do not let those block migration.
  return richTextPlainText(shape?.props?.richText)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim().length > 0
}

function isLegacyArrowCandidate(shape) {
  const props = shape?.props || {}
  if (shape?.typeName !== 'shape' || shape?.type !== 'arrow') return false
  if (props.kind && props.kind !== 'arc') return false
  // A visible label is the one native-arrow feature Station Connector cannot
  // preserve yet. Everything else from the old Connector tool can migrate.
  if (hasVisibleArrowLabel(shape)) return false
  return true
}

export function connectorPointMap(points) {
  const normalized = (points || [])
    .filter(point => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
    .map(point => ({ x: Number(point.x), y: Number(point.y) }))
  if (normalized.length < 2) return null

  const ids = getIndices(normalized.length)
  return Object.fromEntries(normalized.map((point, index) => {
    const id = ids[index]
    return [id, { id, index: id, x: point.x, y: point.y }]
  }))
}

export function normalizeStoredPointMap(points) {
  if (Array.isArray(points)) return connectorPointMap(points)
  if (!points || typeof points !== 'object') return null

  const entries = []
  for (const [key, point] of Object.entries(points)) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue
    const id = String(point.id || key)
    const index = String(point.index || key)
    entries.push([id, {
      ...point,
      id,
      index,
      x: Number(point.x),
      y: Number(point.y),
    }])
  }
  return entries.length >= 2 ? Object.fromEntries(entries) : null
}


export function normalizeStoredConnectorProps(props = {}) {
  const points = normalizeStoredPointMap(props?.points)
  if (!points) return null
  const rawScale = Number(props?.scale)
  return {
    ...props,
    points,
    spline: props?.spline || 'cubic',
    scale: Number.isFinite(rawScale) ? rawScale : 1,
  }
}

// Normalize every historical Station Connector snapshot, not only the first
// array-based version. Several intermediate builds already stored a point map
// but did not carry LineShapeUtil's spline/scale fields, which left those old
// connectors looking fine while missing the new midpoint editing behavior.
export function migrateStoredStationConnectors(snapshot) {
  const store = snapshot?.store
  if (!store || typeof store !== 'object') return snapshot

  let changed = false
  const nextStore = { ...store }
  for (const [key, record] of Object.entries(store)) {
    if (record?.typeName !== 'shape' || record?.type !== 's8-connector') continue

    const props = normalizeStoredConnectorProps(record.props)
    if (!props) continue
    nextStore[key] = {
      ...record,
      props,
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

// Upgrade native arrows left behind by the pre-Station Connector toolbar after
// tldraw resolves their rendered endpoints. This preserves visible geometry,
// styling and scale, then gives the old connector the same native midpoint
// interaction as a connector created today.
export function upgradeLoadedLegacyConnectors(editor, { getArrowInfo, createShapeId }) {
  if (!editor || typeof getArrowInfo !== 'function' || typeof createShapeId !== 'function') return 0
  const arrows = editor.getCurrentPageShapes().filter(isLegacyArrowCandidate)
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

    const rawScale = Number(arrow.props?.scale)
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
        scale: Number.isFinite(rawScale) ? rawScale : 1,
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
