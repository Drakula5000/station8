import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const canvas = readFileSync(new URL('../TldrawCanvas.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('tldraw file handler diverts Station documents before the default validator', () => {
  assert.match(canvas, /const stationFiles = files\.filter/)
  assert.match(canvas, /pdf\|docx\|pptx/)
  assert.match(canvas, /await onExternalFilesDropRef\.current\(stationFiles\)/)
  assert.match(canvas, /!stationFiles\.includes\(file\)/)
})

test('board file drops use the current board folder and shared Station import queue', () => {
  assert.match(app, /onExternalFilesDrop=\{\(files\) => uploadDroppedFiles\(files, activeDoc\?\.folder_id \|\| null\)\}/)
})
