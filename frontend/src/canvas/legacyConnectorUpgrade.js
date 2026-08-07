function richTextPlainText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return String(node.text || '')
  return (node.content || []).map(richTextPlainText).join('')
}

function nativeArrowPoints(props) {
  const start = props?.start
  const end = props?.end
  if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) return null
  const bend = Number(props.bend || 0)
  if (!Number.isFinite(bend) || Math.abs(bend) < 0.01) return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (!(length > 0)) return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }]
  const middle = {
    x: (start.x + end.x) / 2 + (-dy / length) * bend,
    y: (start.y + end.y) / 2 + (dx / length) * bend,
  }
  return [{ x: start.x, y: start.y }, middle, { x: end.x, y: end.y }]
}

export function upgradeLegacyConnectors(snapshot) {
  const store = snapshot?.store
  if (!store || typeof store !== 'object') return snapshot

  const boundArrowIds = new Set(
    Object.values(store)
      .filter(record => record?.typeName === 'binding' && record?.type === 'arrow' && record?.fromId)
      .map(record => record.fromId)
  )
  let changed = false
  const nextStore = { ...store }

  for (const [key, record] of Object.entries(store)) {
    if (record?.typeName !== 'shape' || record?.type !== 'arrow') continue
    const props = record.props || {}
    // Preserve any native arrow whose semantics our multipoint connector does
    // not yet implement: bindings, labels, elbows, or scaled arrows.
    if (boundArrowIds.has(record.id)) continue
    if (props.kind && props.kind !== 'arc') continue
    if (Math.abs(Number(props.scale || 1) - 1) > 0.0001) continue
    if (richTextPlainText(props.richText).trim()) continue

    const points = nativeArrowPoints(props)
    if (!points) continue
    nextStore[key] = {
      ...record,
      type: 's8-connector',
      meta: { ...record.meta, upgradedFromNativeConnector: true },
      props: {
        points,
        color: props.color || 'black',
        dash: props.dash || 'draw',
        size: props.size || 'm',
        arrowheadStart: props.arrowheadStart || 'none',
        arrowheadEnd: props.arrowheadEnd || 'arrow',
      },
    }
    changed = true
  }

  return changed ? { ...snapshot, store: nextStore } : snapshot
}
