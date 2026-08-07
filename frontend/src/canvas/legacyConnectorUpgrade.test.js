import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./legacyConnectorUpgrade.js', import.meta.url), 'utf8')

test('stored Station connectors migrate from arrays to native indexed point maps', () => {
  assert.match(source, /import \{ getIndices \} from 'tldraw'/)
  assert.match(source, /export function connectorPointMap/)
  assert.match(source, /return \[id, \{ id, index: id, x: point\.x, y: point\.y \}\]/)
  assert.match(source, /export function migrateStoredStationConnectors/)
  assert.match(source, /Array\.isArray\(record\.props\?\.points\)/)
  assert.match(source, /spline: record\.props\?\.spline \|\| 'cubic'/)
})

test('legacy native arrows are resolved after load and replaced with native point-map Station connectors', () => {
  assert.match(source, /export function upgradeLoadedLegacyConnectors/)
  assert.match(source, /getArrowInfo\(editor, arrow\)/)
  assert.match(source, /connectorPointMap\(connectorPointsFromArrowInfo\(info\)\)/)
  assert.match(source, /editor\.deleteShapes\(\[arrow\.id\]\)/)
  assert.match(source, /editor\.createShape\(replacement\)/)
  assert.match(source, /type: 's8-connector'/)
  assert.match(source, /spline: 'cubic'/)
})

test('labeled and elbow native arrows remain excluded from automatic upgrade', () => {
  assert.match(source, /props\.kind && props\.kind !== 'arc'/)
  assert.match(source, /richTextPlainText\(props\.richText\)\.trim\(\)/)
  assert.match(source, /info\.type === 'elbow'/)
})
