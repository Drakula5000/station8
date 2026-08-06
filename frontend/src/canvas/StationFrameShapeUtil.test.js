import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./StationFrameShapeUtil.js', import.meta.url), 'utf8')

test('Station sections preserve frame behavior without clipping children', () => {
  assert.match(source, /FrameShapeUtil\.configure\(\{ showColors: true \}\)/)
  assert.match(source, /shouldClipChild\(\)\s*\{\s*return false\s*\}/)
})
