import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./legacyConnectorUpgrade.js', import.meta.url), 'utf8')

test('stored Station connectors normalize every historical point representation', () => {
  assert.match(source, /export function connectorPointMap/)
  assert.match(source, /function normalizeStoredPointMap/)
  assert.match(source, /Array\.isArray\(points\)/)
  assert.match(source, /const id = String\(point\.id \|\| key\)/)
  assert.match(source, /export function migrateStoredStationConnectors/)
  assert.match(source, /spline: record\.props\?\.spline \|\| 'cubic'/)
  assert.match(source, /Number\.isFinite\(rawScale\) \? rawScale : 1/)
})

test('legacy native arrows are resolved after load and replaced with Station connectors', () => {
  assert.match(source, /export function upgradeLoadedLegacyConnectors/)
  assert.match(source, /getArrowInfo\(editor, arrow\)/)
  assert.match(source, /connectorPointMap\(connectorPointsFromArrowInfo\(info\)\)/)
  assert.match(source, /editor\.deleteShapes\(\[arrow\.id\]\)/)
  assert.match(source, /editor\.createShape\(replacement\)/)
  assert.match(source, /type: 's8-connector'/)
  assert.match(source, /scale: Number\.isFinite\(rawScale\) \? rawScale : 1/)
})

test('visible labels and elbow arrows remain excluded while empty-format labels can migrate', () => {
  assert.match(source, /replace\(\/\[\\u200B-\\u200D\\u2060\\uFEFF\]\//)
  assert.match(source, /if \(hasVisibleArrowLabel\(shape\)\) return false/)
  assert.match(source, /info\.type === 'elbow'/)
})
