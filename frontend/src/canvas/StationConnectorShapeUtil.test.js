import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./StationConnectorShapeUtil.jsx', import.meta.url), 'utf8')

test('Station Connector keeps native Line drag behavior with fresh midpoint handles', () => {
  assert.match(source, /extends LineShapeUtil/)
  assert.match(source, /\.\.\.LineShapeUtil\.props/)
  assert.match(source, /getHandles\(shape\)/)
  assert.match(source, /getIndexBetween\(points\[index\]\.index, points\[index \+ 1\]\.index\)/)
  assert.match(source, /type: 'create'/)
  assert.doesNotMatch(source, /onHandleDragStart\s*\(/)
  assert.doesNotMatch(source, /onHandleDrag\s*\(/)
})
