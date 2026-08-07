import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./StationConnectorShapeUtil.jsx', import.meta.url), 'utf8')

test('connector create handle keeps the same id when it becomes a vertex', () => {
  assert.match(source, /getIndexBetween/)
  assert.match(source, /nextIds\.splice\(segmentIndex \+ 1, 0, info\.handle\.id\)/)
  assert.match(source, /connectorPointIds: nextIds/)
  assert.doesNotMatch(source, /id: `insert:/)
})
