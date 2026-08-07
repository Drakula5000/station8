import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const util = readFileSync(new URL('./StationArrowShapeUtil.jsx', import.meta.url), 'utf8')
const canvas = readFileSync(new URL('../TldrawCanvas.jsx', import.meta.url), 'utf8')

test('Connector supports repeatable curve-point creation', () => {
  assert.match(util, /extends ArrowShapeUtil/)
  assert.match(util, /connectorPoints/)
  assert.match(util, /type: 'create'/)
  assert.match(util, /onHandleDragStart/)
  assert.match(util, /cubicSplineThroughPoints/)
})

test('Canvas uses Station connector util instead of the unrelated Line override', () => {
  assert.match(canvas, /StationArrowShapeUtil/)
  assert.doesNotMatch(canvas, /StationLineShapeUtil/)
})
