import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STATION_TEXT_FONT_SIZES,
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
