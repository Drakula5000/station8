from pathlib import Path

legacy = '''function richTextPlainText(node) {
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
'''
Path('frontend/src/canvas/legacyConnectorUpgrade.js').write_text(legacy)

Path('frontend/src/canvas/legacyConnectorUpgrade.test.js').write_text('''import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { connectorPointsFromArrowInfo, upgradeLoadedLegacyConnectors } from './legacyConnectorUpgrade.js'\n\nconst legacyArrow = (overrides = {}) => ({\n  typeName: 'shape', id: 'shape:red', type: 'arrow', x: 10, y: 20, rotation: 0, index: 'a1', parentId: 'page:page', opacity: 1, isLocked: false, meta: {},\n  props: { kind: 'arc', scale: 1, color: 'red', dash: 'dashed', size: 'm', arrowheadStart: 'arrow', arrowheadEnd: 'bar', richText: { type: 'doc', content: [] }, ...overrides },\n})\n\ntest('rendered native arc geometry becomes Station connector points', () => {\n  assert.deepEqual(connectorPointsFromArrowInfo({\n    type: 'arc', start: { point: { x: 1, y: 2 } }, middle: { x: 50, y: 30 }, end: { point: { x: 100, y: 4 } },\n  }), [{ x: 1, y: 2 }, { x: 50, y: 30 }, { x: 100, y: 4 }])\n})\n\ntest('bound/simple old arrows can upgrade after tldraw resolves their rendered geometry', () => {\n  const deleted = []\n  const created = []\n  const editor = {\n    getCurrentPageShapes: () => [legacyArrow()],\n    deleteShapes: ids => deleted.push(...ids),\n    createShape: shape => created.push(shape),\n  }\n  const count = upgradeLoadedLegacyConnectors(editor, {\n    createShapeId: () => 'shape:new',\n    getArrowInfo: () => ({\n      type: 'arc', start: { point: { x: 2, y: 3 } }, middle: { x: 40, y: 25 }, end: { point: { x: 90, y: 5 } },\n    }),\n  })\n  assert.equal(count, 1)\n  assert.deepEqual(deleted, ['shape:red'])\n  assert.equal(created[0].type, 's8-connector')\n  assert.equal(created[0].props.color, 'red')\n  assert.equal(created[0].props.arrowheadStart, 'arrow')\n  assert.equal(created[0].props.arrowheadEnd, 'bar')\n  assert.deepEqual(created[0].props.points, [{ x: 2, y: 3 }, { x: 40, y: 25 }, { x: 90, y: 5 }])\n})\n\ntest('labeled and elbow arrows remain native', () => {\n  const shapes = [\n    legacyArrow({ richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'label' }] }] } }),\n    { ...legacyArrow({ kind: 'elbow' }), id: 'shape:elbow' },\n  ]\n  const created = []\n  const editor = {\n    getCurrentPageShapes: () => shapes,\n    deleteShapes: () => { throw new Error('should not delete') },\n    createShape: shape => created.push(shape),\n  }\n  assert.equal(upgradeLoadedLegacyConnectors(editor, { createShapeId: () => 'shape:new', getArrowInfo: () => null }), 0)\n  assert.deepEqual(created, [])\n})\n''')

canvas = Path('frontend/src/TldrawCanvas.jsx')
text = canvas.read_text()
old_import = "import { Tldraw, getSvgAsImage } from 'tldraw'"
new_import = "import { Tldraw, createShapeId, getArrowInfo, getSvgAsImage } from 'tldraw'"
if old_import not in text:
    raise SystemExit('tldraw import anchor missing')
text = text.replace(old_import, new_import, 1)
old_upgrade_import = "import { upgradeLegacyConnectors } from './canvas/legacyConnectorUpgrade'"
new_upgrade_import = "import { upgradeLoadedLegacyConnectors } from './canvas/legacyConnectorUpgrade'"
if old_upgrade_import not in text:
    raise SystemExit('legacy upgrade import anchor missing')
text = text.replace(old_upgrade_import, new_upgrade_import, 1)
old_load = '''        if (data.snapshot?.store) {
          // Upgrade only simple legacy native arrows. Bound/labeled/elbow arrows
          // remain stock tldraw shapes so no connector semantics are discarded.
          editor.store.loadStoreSnapshot(upgradeLegacyConnectors(data.snapshot))
        }
'''
new_load = '''        if (data.snapshot?.store) {
          // Load native arrows first so tldraw can resolve any endpoint bindings
          // into their actual rendered geometry. Then upgrade simple legacy
          // arrows (bound or unbound) to the Station multipoint connector.
          editor.store.loadStoreSnapshot(data.snapshot)
          upgradeLoadedLegacyConnectors(editor, { getArrowInfo, createShapeId })
        }
'''
if old_load not in text:
    raise SystemExit('board load upgrade anchor missing')
text = text.replace(old_load, new_load, 1)
canvas.write_text(text)
