import test from 'node:test'
import assert from 'node:assert/strict'
import {
  connectorPointMap,
  connectorPointsFromArrowInfo,
  migrateStoredStationConnectors,
  upgradeLoadedLegacyConnectors,
} from './legacyConnectorUpgrade.js'

const legacyArrow = (overrides = {}) => ({
  typeName: 'shape', id: 'shape:red', type: 'arrow', x: 10, y: 20, rotation: 0, index: 'a1', parentId: 'page:page', opacity: 1, isLocked: false, meta: {},
  props: { kind: 'arc', scale: 1, color: 'red', dash: 'dashed', size: 'm', arrowheadStart: 'arrow', arrowheadEnd: 'bar', richText: { type: 'doc', content: [] }, ...overrides },
})

test('connector point maps use stable tldraw Line ids and indexes', () => {
  const mapped = connectorPointMap([{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }])
  const points = Object.values(mapped)
  assert.equal(points.length, 3)
  for (const point of points) {
    assert.equal(point.id, point.index)
    assert.equal(typeof point.index, 'string')
  }
})

test('stored array-based Station connectors migrate before tldraw validates them', () => {
  const snapshot = { store: {
    'shape:one': {
      typeName: 'shape', id: 'shape:one', type: 's8-connector',
      props: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', dash: 'draw', size: 'm' },
    },
  } }
  const migrated = migrateStoredStationConnectors(snapshot)
  const props = migrated.store['shape:one'].props
  assert.equal(Array.isArray(props.points), false)
  assert.equal(Object.keys(props.points).length, 2)
  assert.equal(props.spline, 'cubic')
  assert.equal(props.scale, 1)
})

test('rendered native arc geometry becomes Station connector points', () => {
  assert.deepEqual(connectorPointsFromArrowInfo({
    type: 'arc', start: { point: { x: 1, y: 2 } }, middle: { x: 50, y: 30 }, end: { point: { x: 100, y: 4 } },
  }), [{ x: 1, y: 2 }, { x: 50, y: 30 }, { x: 100, y: 4 }])
})

test('bound/simple old arrows upgrade to native point-map Station connectors', () => {
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
  assert.equal(Array.isArray(created[0].props.points), false)
  assert.equal(Object.keys(created[0].props.points).length, 3)
  assert.equal(created[0].props.spline, 'cubic')
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
