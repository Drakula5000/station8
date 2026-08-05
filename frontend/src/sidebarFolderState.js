export const SIDEBAR_FOLDER_STATE_KEY = 's8.expandedFolders'

function sanitizeFolderState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const state = {}
  for (const [folderId, expanded] of Object.entries(value)) {
    if (typeof expanded === 'boolean') state[folderId] = expanded
  }
  return state
}

export function loadFolderExpansionState(storage) {
  if (!storage) return {}
  try {
    const raw = storage.getItem(SIDEBAR_FOLDER_STATE_KEY)
    return raw ? sanitizeFolderState(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export function saveFolderExpansionState(storage, state) {
  if (!storage) return
  try {
    storage.setItem(SIDEBAR_FOLDER_STATE_KEY, JSON.stringify(sanitizeFolderState(state)))
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export function mergeFolderExpansionDefaults(current, folders) {
  const next = { ...sanitizeFolderState(current) }
  for (const folder of folders || []) {
    if (typeof next[folder.id] !== 'boolean') next[folder.id] = true
  }
  return next
}
