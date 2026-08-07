import test from 'node:test'
import assert from 'node:assert/strict'
import { connectorPointsFromArrowInfo, upgradeLoadedLegacyConnectors } from './legacyConnectorUpgrade.js'

const legacyArrow = (overrides = {}) => ({
  typeName: 'shape', id: 'shape:red', type: 'arrow', x: 10, y: 20, rotation: 0, index: 'a1', parentId: 'page:page', opacity: 1, isLocked: false, meta: {},
  props: { kind: 'arc', scale: 1, color: 'red', dash: 'dashed', size: 'm', arrowheadStart: 'arrow', arrowheadEnd: 'bar', richText: { type: 'doc', content: [] }, ...overrides },
})

test('rendered native arc geometry becomes Station connector points', () => {
  assert.deepEqual(connectorPointsFromArrowInfo({
    type: 'arc', start: { point: { x: 1, y: 2 } }, middle: { x: 50, y: 30 }, end: { point: { x: 100, y: 4 } },
  }), [{ x: 1, y: 2 }, { x: 50, y: 30 }, { x: 100, y: 4 }])
})

test('bound/simple old arrows can upgrade after tldraw resolves their rendered geometry', () => {
  const deleted = []
  const created = []
  const editor = {
    getCurrentPageShapes: () => [legacyArrow()],
    deleteShapes: ids => deleted.push(...ids),
    createShape: shape => created.push(shape),
  }
  const count = upgradeLoadedLegacyConnectors(editor, {
    createShapeId: () => 'shape:new',
    getArrowInfo: () => ({
      type: 'arc', start: { point: { x: 2, y: 3 } }, middle: { x: 40, y: 25 }, end: { point: { x: 90, y: 5 } },
    }),
  })
  assert.equal(count, 1)
  assert.deepEqual(deleted, ['shape:red'])
  assert.equal(created[0].type, 's8-connector')
  assert.equal(created[0].props.color, 'red')
  assert.equal(created[0].props.arrowheadStart, 'arrow')
  assert.equal(created[0].props.arrowheadEnd, 'bar')
  assert.deepEqual(created[0].props.points, [{ x: 2, y: 3 }, { x: 40, y: 25 }, { x: 90, y: 5 }])
})

test('labeled and elbow arrows remain native', () => {
  const shapes = [
    legacyArrow({ richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'label' }] }] } }),
    { ...legacyArrow({ kind: 'elbow' }), id: 'shape:elbow' },
  ]
  const created = []
  const editor = {
    getCurrentPageShapes: () => shapes,
    deleteShapes: () => { throw new Error('should not delete') },
    createShape: shape => created.push(shape),
  }
  assert.equal(upgradeLoadedLegacyConnectors(editor, { createShapeId: () => 'shape:new', getArrowInfo: () => null }), 0)
  assert.deepEqual(created, [])
})
