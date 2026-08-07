import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./StationConnectorShapeUtil.jsx', import.meta.url), 'utf8')

test('Station Connector inherits tldraw native Line midpoint interaction', () => {
  assert.match(source, /extends LineShapeUtil/)
  assert.match(source, /\.\.\.LineShapeUtil\.props/)
  assert.doesNotMatch(source, /onHandleDragStart\s*\(/)
  assert.doesNotMatch(source, /onHandleDrag\s*\(/)
})
