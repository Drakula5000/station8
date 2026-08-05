import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STATION_TEXT_FONT_SIZES,
  getStationTextAnchorDelta,
  getStationTextExportMetrics,
  getStationTextFontSize,
} from './stationTextSizing.js'

test('Station text sizes stay smaller than tldraw defaults', () => {
  assert.deepEqual(STATION_TEXT_FONT_SIZES, { s: 8, m: 12, l: 16, xl: 22 })
  assert.equal(getStationTextFontSize('s'), 8)
  assert.equal(getStationTextFontSize('m'), 12)
  assert.equal(getStationTextFontSize('l'), 16)
  assert.equal(getStationTextFontSize('xl'), 22)
  assert.equal(getStationTextFontSize('unknown'), 8)
})

test('export metrics use Station sizing and preserve scaled bounds', () => {
  const metrics = getStationTextExportMetrics(
    { size: 'm', scale: 2 },
    { width: 160, height: 64 },
  )

  assert.deepEqual(metrics, {
    fontSize: 12,
    width: 80,
    height: 32,
  })
})

test('centered typing keeps the visual center fixed using real width growth', () => {
  const delta = getStationTextAnchorDelta(
    'middle',
    true,
    { width: 16, height: 12 },
    { width: 96, height: 12 },
  )

  assert.deepEqual(delta, { x: 40, y: 0 })
  const beforeCenter = 1000 + 16 / 2
  const afterCenter = (1000 - delta.x) + 96 / 2
  assert.equal(afterCenter, beforeCenter)
})

test('left-aligned typing does not move the shape', () => {
  assert.equal(
    getStationTextAnchorDelta(
      'start',
      true,
      { width: 16, height: 12 },
      { width: 96, height: 12 },
    ),
    null,
  )
})

test('right-aligned typing keeps the right edge fixed', () => {
  const delta = getStationTextAnchorDelta(
    'end',
    true,
    { width: 16, height: 12 },
    { width: 96, height: 12 },
  )

  assert.deepEqual(delta, { x: 80, y: 0 })
  const beforeRight = 1000 + 16
  const afterRight = (1000 - delta.x) + 96
  assert.equal(afterRight, beforeRight)
})
