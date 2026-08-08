import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  connectorPointMap,
  normalizeStoredConnectorProps,
  normalizeStoredPointMap,
} from './legacyConnectorUpgrade.js'

test('array-based legacy connector points normalize to an indexed point map', () => {
  const points = normalizeStoredPointMap([{ x: '1', y: 2 }, { x: 3, y: '4' }])
  assert.equal(Object.keys(points).length, 2)
  assert.deepEqual(Object.values(points).map(({ x, y }) => [x, y]), [[1, 2], [3, 4]])
})

test('historical point maps retain IDs while missing Line props get safe defaults', () => {
  const props = normalizeStoredConnectorProps({
    points: {
      a1: { id: 'a1', index: 'a1', x: 5, y: 6 },
      a2: { id: 'a2', index: 'a2', x: 7, y: 8 },
    },
    color: 'red',
  })
  assert.equal(props.points.a1.id, 'a1')
  assert.equal(props.spline, 'cubic')
  assert.equal(props.scale, 1)
  assert.equal(props.color, 'red')
})

test('invalid connector point sets are rejected rather than fabricated', () => {
  assert.equal(connectorPointMap([{ x: 1, y: 2 }]), null)
  assert.equal(normalizeStoredConnectorProps({ points: { only: { x: 1, y: 2 } } }), null)
})

test('Station Connector registers a formal tldraw prop migration', () => {
  const source = readFileSync(new URL('./StationConnectorShapeUtil.jsx', import.meta.url), 'utf8')
  assert.match(source, /createShapePropsMigrationIds/)
  assert.match(source, /createShapePropsMigrationSequence/)
  assert.match(source, /static migrations = stationConnectorMigrations/)
})
