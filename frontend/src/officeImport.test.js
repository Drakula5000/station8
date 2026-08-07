import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyDroppedFile } from './officeImport.js'

test('drop classifier routes PDF, Word, and PowerPoint without confusing Office files for PDFs', () => {
  assert.deepEqual(classifyDroppedFile({ name: 'paper.PDF' }), { type: 'pdf' })
  assert.deepEqual(classifyDroppedFile({ name: 'notes.docx' }), { type: 'office', kind: 'gdoc', label: 'Google Doc' })
  assert.deepEqual(classifyDroppedFile({ name: 'deck.PPTX' }), { type: 'office', kind: 'gslide', label: 'Google Slides' })
  assert.deepEqual(classifyDroppedFile({ name: 'data.xlsx' }), { type: 'unsupported' })
})
