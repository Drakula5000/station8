import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./StationConnectorShapeUtil.jsx', import.meta.url), 'utf8')

test('connector drag resolves the persistent create handle against the initial shape', () => {
  assert.match(source, /const \{ handle, initial \} = info/)
  assert.match(source, /const initialPoints = normalizeConnectorPoints\(initial\?\.props\?\.points\)/)
  assert.match(source, /pointIndex = initialSegmentIndex \+ 1/)
  assert.doesNotMatch(source, /connectorPointIds/)
})

test('connector still uses fractional create-handle indices', () => {
  assert.match(source, /getIndexBetween/)
  assert.match(source, /type: 'create'/)
  assert.match(source, /canSnap: true/)
})
