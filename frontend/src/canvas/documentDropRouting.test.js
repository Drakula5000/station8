import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { partitionDroppedFiles } from '../fileDropRouting.js'

function file(name, type = '') { return { name, type } }

test('Station document drops are separated from media and unsupported files', () => {
  const result = partitionDroppedFiles([
    file('paper.pdf', 'application/pdf'),
    file('notes.docx'),
    file('deck.pptx'),
    file('photo.png', 'image/png'),
    file('clip.mp4', 'video/mp4'),
    file('data.xlsx'),
  ])
  assert.deepEqual(result.stationFiles.map(item => item.name), ['paper.pdf', 'notes.docx', 'deck.pptx'])
  assert.deepEqual(result.mediaFiles.map(item => item.name), ['photo.png', 'clip.mp4'])
  assert.deepEqual(result.otherFiles.map(item => item.name), ['data.xlsx'])
})

test('canvas uses one registered file pipeline rather than a second DOM drop capture', () => {
  const canvas = readFileSync(new URL('../TldrawCanvas.jsx', import.meta.url), 'utf8')
  assert.match(canvas, /partitionDroppedFiles\(files\)/)
  assert.match(canvas, /onExternalFilesDropRef\.current\(stationFiles\)/)
  assert.doesNotMatch(canvas, /onDropCapture=/)
  assert.doesNotMatch(canvas, /handleDocumentDropCapture/)
})
