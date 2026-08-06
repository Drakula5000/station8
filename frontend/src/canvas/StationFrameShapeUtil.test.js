import test from 'node:test'
import assert from 'node:assert/strict'

import { StationFrameShapeUtil } from './StationFrameShapeUtil.js'

test('Station sections preserve frame behavior without clipping children', () => {
  const util = Object.create(StationFrameShapeUtil.prototype)
  for (const child of [
    { type: 'text' },
    { type: 'image' },
    { type: 'note' },
    { type: 'geo' },
  ]) {
    assert.equal(util.shouldClipChild(child), false)
  }
  assert.equal(StationFrameShapeUtil.type, 'frame')
})
