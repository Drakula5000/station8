import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STATION_TEXT_FONT_SIZES,
  StationTextShapeUtil,
  getStationTextFontSize,
} from './StationTextShapeUtil.js'

test('Station text sizes stay smaller than tldraw defaults', () => {
  assert.deepEqual(STATION_TEXT_FONT_SIZES, { s: 8, m: 12, l: 16, xl: 22 })
  assert.equal(getStationTextFontSize('s'), 8)
  assert.equal(getStationTextFontSize('m'), 12)
  assert.equal(getStationTextFontSize('l'), 16)
  assert.equal(getStationTextFontSize('xl'), 22)
  assert.equal(getStationTextFontSize('unknown'), 8)
})

test('text SVG export uses Station sizing and preserves scaled bounds', () => {
  const shape = {
    props: {
      scale: 2,
      size: 'm',
      font: 'mono',
      textAlign: 'start',
      richText: { type: 'doc', content: [] },
      color: 'black',
    },
  }
  const fakeUtil = {
    editor: {
      getShapeGeometry() {
        return { bounds: { width: 160, height: 64 } }
      },
    },
    options: { showTextOutline: false },
  }

  const element = StationTextShapeUtil.prototype.toSvg.call(
    fakeUtil,
    shape,
    { isDarkMode: false },
  )

  assert.equal(element.props.fontSize, 12)
  assert.equal(element.props.font, 'mono')
  assert.equal(element.props.align, 'start')
  assert.equal(element.props.bounds.w, 80)
  assert.equal(element.props.bounds.h, 32)
  assert.equal(element.props.showTextOutline, false)
})
