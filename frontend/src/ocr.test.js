import assert from 'node:assert/strict'
import test from 'node:test'

import { getOcrRasterSize, normalizeOcrText, ocrImage, recognizeImageText } from './ocr.js'

test('OCR raster sizing uses the measured 2000px PDF width and hard memory bounds', () => {
  const sample = getOcrRasterSize(1349.33, 1040)
  assert.equal(sample.width, 2000)
  assert.equal(sample.height, 1542)
  assert.ok(sample.width * sample.height <= 6_000_000)
  assert.ok(Math.max(sample.width, sample.height) <= 4096)

  const extremePortrait = getOcrRasterSize(1000, 20_000)
  assert.ok(extremePortrait.width * extremePortrait.height <= 6_000_000)
  assert.ok(Math.max(extremePortrait.width, extremePortrait.height) <= 4096)
})

test('OCR text normalization creates compact search text', () => {
  assert.equal(normalizeOcrText('  Robot\n\n Boy\twas made of tin.  '), 'Robot Boy was made of tin.')
})

test('strict PDF OCR surfaces failures while board-image OCR remains best effort', async () => {
  await assert.rejects(recognizeImageText(null), /prepare an image for OCR/)
  assert.equal(await ocrImage(null), '')
})
