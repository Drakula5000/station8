import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SIDEBAR_FOLDER_STATE_KEY,
  loadFolderExpansionState,
  mergeFolderExpansionDefaults,
  saveFolderExpansionState,
} from './sidebarFolderState.js'

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null },
    setItem(key, value) { data.set(key, String(value)) },
  }
}

test('folder expansion state survives a storage round trip', () => {
  const storage = memoryStorage()
  saveFolderExpansionState(storage, { research: false, classes: true })
  assert.deepEqual(loadFolderExpansionState(storage), {
    research: false,
    classes: true,
  })
})

test('invalid stored values cannot turn folders into accidental states', () => {
  const storage = memoryStorage({
    [SIDEBAR_FOLDER_STATE_KEY]: JSON.stringify({
      closed: false,
      open: true,
      stringValue: 'false',
      nullValue: null,
    }),
  })
  assert.deepEqual(loadFolderExpansionState(storage), {
    closed: false,
    open: true,
  })
})

test('new folders default open without overwriting how existing folders were left', () => {
  const state = mergeFolderExpansionDefaults(
    { storytime: false, classes: true, otherAccountFolder: false },
    [{ id: 'storytime' }, { id: 'classes' }, { id: 'new-folder' }],
  )
  assert.deepEqual(state, {
    storytime: false,
    classes: true,
    otherAccountFolder: false,
    'new-folder': true,
  })
})
