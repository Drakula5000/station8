import test from 'node:test'
import assert from 'node:assert/strict'

import { AUTO_IMAGE_BORDER, normalizeImageBorderColor } from './imageBorder.js'

test('image borders default to mode-aware auto color', () => {
  assert.equal(normalizeImageBorderColor(undefined), AUTO_IMAGE_BORDER)
  assert.equal(normalizeImageBorderColor(null), AUTO_IMAGE_BORDER)
  assert.equal(normalizeImageBorderColor(''), AUTO_IMAGE_BORDER)
})

test('explicit image border colors remain explicit', () => {
  assert.equal(normalizeImageBorderColor('var(--s8-tl-teal)'), 'var(--s8-tl-teal)')
  assert.equal(normalizeImageBorderColor(AUTO_IMAGE_BORDER), AUTO_IMAGE_BORDER)
})
