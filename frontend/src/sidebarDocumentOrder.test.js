import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appendSidebarDocument,
  reorderSidebarDocuments,
  sidebarDocumentKey,
  sortSidebarDocuments,
} from './sidebarDocumentOrder.js'

const docs = [
  { type: 'board', id: 'step-1', name: 'STEP 01', folder_id: 'course' },
  { type: 'board', id: 'step-2', name: 'STEP 2', folder_id: 'course' },
  { type: 'pdf', id: 'reading', name: 'Reading', folder_id: 'course' },
  { type: 'gdoc', id: 'notes', name: 'Notes', folder_id: 'other' },
]

test('same-folder drop persists the dragged document before its target', () => {
  const order = reorderSidebarDocuments({}, docs, docs[1], docs[0], 'before')
  assert.deepEqual(order.course, [
    sidebarDocumentKey(docs[1]),
    sidebarDocumentKey(docs[0]),
    sidebarDocumentKey(docs[2]),
  ])
  assert.deepEqual(
    sortSidebarDocuments(docs.filter(doc => doc.folder_id === 'course'), order, 'course').map(doc => doc.id),
    ['step-2', 'step-1', 'reading'],
  )
})

test('dropping after a target uses the lower insertion position', () => {
  const initial = { course: ['board:step-1', 'board:step-2', 'pdf:reading'] }
  const order = reorderSidebarDocuments(initial, docs, docs[0], docs[1], 'after')
  assert.deepEqual(order.course, ['board:step-2', 'board:step-1', 'pdf:reading'])
})

test('moving to another folder removes the old entry and inserts beside the target', () => {
  const order = reorderSidebarDocuments({}, docs, docs[0], docs[3], 'after')
  assert.deepEqual(order.course, ['board:step-2', 'pdf:reading'])
  assert.deepEqual(order.other, ['gdoc:notes', 'board:step-1'])
})

test('dropping on a folder appends without losing existing manual order', () => {
  const initial = {
    course: ['pdf:reading', 'board:step-1', 'board:step-2'],
    other: ['gdoc:notes'],
  }
  const order = appendSidebarDocument(initial, docs, docs[1], 'other')
  assert.deepEqual(order.course, ['pdf:reading', 'board:step-1'])
  assert.deepEqual(order.other, ['gdoc:notes', 'board:step-2'])
})
