import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const canvas = readFileSync(new URL('../TldrawCanvas.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')

test('canvas captures Station document drops before tldraw handles them', () => {
  assert.match(canvas, /onDropCapture=\{handleDocumentDropCapture\}/)
  assert.match(canvas, /pdf\|docx\|pptx/)
  assert.match(canvas, /event\.preventDefault\(\)/)
  assert.match(canvas, /event\.stopPropagation\(\)/)
  assert.match(canvas, /void onExternalFilesDrop\(stationFiles\)/)
})

test('board file drops use the current board folder and shared Station import queue', () => {
  assert.match(app, /onExternalFilesDrop=\{\(files\) => uploadDroppedFiles\(files, activeDoc\?\.folder_id \|\| null\)\}/)
})
