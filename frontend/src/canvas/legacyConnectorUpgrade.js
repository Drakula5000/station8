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

export function connectorPointsFromArrowInfo(info) {
  if (!info || !info.start?.point || !info.end?.point || info.type === 'elbow') return null
  const points = info.type === 'arc'
    ? [info.start.point, info.middle, info.end.point]
    : [info.start.point, info.end.point]
  if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null
  return points.map(point => ({ x: Number(point.x), y: Number(point.y) }))
}

// Upgrade after the native snapshot is loaded, not before. This lets tldraw
// resolve bound arrow terminals and give us the arrow's actual rendered
// start/middle/end points. Bound legacy arrows therefore keep their visible
// geometry when they become Station connectors instead of jumping into the
// shapes they used to be attached to.
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
    const points = connectorPointsFromArrowInfo(info)
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
        color: arrow.props?.color || 'black',
        dash: arrow.props?.dash || 'draw',
        size: arrow.props?.size || 'm',
        arrowheadStart: arrow.props?.arrowheadStart || 'none',
        arrowheadEnd: arrow.props?.arrowheadEnd || 'arrow',
      },
    }

    // Deleting the native arrow also retires its ArrowBinding records. We only
    // do this after getArrowInfo has resolved the bound geometry above.
    editor.deleteShapes([arrow.id])
    editor.createShape(replacement)
    upgraded += 1
  }

  return upgraded
}
