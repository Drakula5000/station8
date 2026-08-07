import test from 'node:test'
import assert from 'node:assert/strict'

import {
  connectorMidpoint,
  insertConnectorPoint,
  moveConnectorPoint,
  normalizeConnectorPoints,
} from './stationConnectorPoints.js'

test('connector accepts repeatable point insertion without a fixed limit', () => {
  let points = [{ x: 0, y: 0 }, { x: 120, y: 0 }]
  points = insertConnectorPoint(points, 0, { x: 60, y: 40 })
  points = insertConnectorPoint(points, 1, { x: 90, y: -40 })
  points = insertConnectorPoint(points, 0, { x: 30, y: -20 })

  assert.deepEqual(points, [
    { x: 0, y: 0 },
    { x: 30, y: -20 },
    { x: 60, y: 40 },
    { x: 90, y: -40 },
    { x: 120, y: 0 },
  ])
})

test('dragging one connector point only moves that point', () => {
  const original = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }]
  const moved = moveConnectorPoint(original, 1, { x: 50, y: -80 })
  assert.deepEqual(moved, [{ x: 0, y: 0 }, { x: 50, y: -80 }, { x: 100, y: 0 }])
  assert.deepEqual(original, [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }])
})

test('malformed connector point data falls back to a safe two-point shape', () => {
  assert.deepEqual(normalizeConnectorPoints(null), [{ x: 0, y: 0 }, { x: 160, y: 0 }])
  assert.deepEqual(normalizeConnectorPoints([{ x: 3, y: 4 }]), [{ x: 0, y: 0 }, { x: 160, y: 0 }])
})

test('connector midpoint is centered between neighboring points', () => {
  assert.deepEqual(connectorMidpoint({ x: -20, y: 10 }, { x: 80, y: 50 }), { x: 30, y: 30 })
})
