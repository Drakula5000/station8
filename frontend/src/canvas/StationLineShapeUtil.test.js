import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./StationLineShapeUtil.js', import.meta.url), 'utf8')

test('Station lines use unlimited native points as smooth curve controls', () => {
  assert.match(source, /extends LineShapeUtil/)
  assert.match(source, /getDefaultProps\(\).*spline: 'cubic'/s)
  assert.match(source, /handle\.type !== 'create'/)
  assert.match(source, /props: \{ \.\.\.next\.props, spline: 'cubic' \}/)
})
