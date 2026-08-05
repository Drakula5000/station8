// Pure ordering helpers shared by drag/drop and sidebar rendering. The stored
// map is workspace data, so manual document order survives reloads and devices.
export const SIDEBAR_ROOT_PARENT = '__root__'

const DOC_TYPE_ORDER = {
  board: 0,
  gdoc: 1,
  gsheet: 2,
  report: 3,
  pdf: 4,
}

export function sidebarParentKey(folderId) {
  return folderId || SIDEBAR_ROOT_PARENT
}

export function sidebarDocumentKey(doc) {
  return `${doc.type}:${doc.id}`
}

function compareFallback(a, b) {
  const typeDelta = (DOC_TYPE_ORDER[a.type] ?? 99) - (DOC_TYPE_ORDER[b.type] ?? 99)
  if (typeDelta) return typeDelta
  return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
}

export function sortSidebarDocuments(items, orderMap, parentId) {
  const order = Array.isArray(orderMap?.[sidebarParentKey(parentId)])
    ? orderMap[sidebarParentKey(parentId)]
    : []
  const ranks = new Map(order.map((key, index) => [key, index]))

  return [...items].sort((a, b) => {
    const aRank = ranks.get(sidebarDocumentKey(a))
    const bRank = ranks.get(sidebarDocumentKey(b))
    const aOrdered = Number.isInteger(aRank)
    const bOrdered = Number.isInteger(bRank)
    if (aOrdered && bOrdered) return aRank - bRank
    if (aOrdered) return -1
    if (bOrdered) return 1
    return compareFallback(a, b)
  })
}

function orderedKeysForParent(orderMap, docs, parentId) {
  return sortSidebarDocuments(
    docs.filter(doc => (doc.folder_id || null) === (parentId || null)),
    orderMap,
    parentId,
  ).map(sidebarDocumentKey)
}

export function reorderSidebarDocuments(orderMap, docs, dragged, target, position = 'before') {
  const draggedKey = sidebarDocumentKey(dragged)
  const targetKey = sidebarDocumentKey(target)
  if (draggedKey === targetKey) return { ...(orderMap || {}) }

  const sourceParent = dragged.folder_id || null
  const targetParent = target.folder_id || null
  const sourceParentKey = sidebarParentKey(sourceParent)
  const targetParentKey = sidebarParentKey(targetParent)
  const next = { ...(orderMap || {}) }

  let sourceKeys = orderedKeysForParent(next, docs, sourceParent)
    .filter(key => key !== draggedKey)
  let targetKeys = sourceParentKey === targetParentKey
    ? sourceKeys
    : orderedKeysForParent(next, docs, targetParent).filter(key => key !== draggedKey)

  const targetIndex = targetKeys.indexOf(targetKey)
  if (targetIndex < 0) return next
  const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex
  targetKeys = [...targetKeys]
  targetKeys.splice(insertionIndex, 0, draggedKey)

  if (sourceParentKey !== targetParentKey) next[sourceParentKey] = sourceKeys
  next[targetParentKey] = targetKeys
  return next
}

export function appendSidebarDocument(orderMap, docs, dragged, targetFolderId) {
  const draggedKey = sidebarDocumentKey(dragged)
  const sourceParent = dragged.folder_id || null
  const targetParent = targetFolderId || null
  const sourceParentKey = sidebarParentKey(sourceParent)
  const targetParentKey = sidebarParentKey(targetParent)
  const next = { ...(orderMap || {}) }

  const sourceKeys = orderedKeysForParent(next, docs, sourceParent)
    .filter(key => key !== draggedKey)
  const targetKeys = sourceParentKey === targetParentKey
    ? sourceKeys
    : orderedKeysForParent(next, docs, targetParent).filter(key => key !== draggedKey)

  next[targetParentKey] = [...targetKeys, draggedKey]
  if (sourceParentKey !== targetParentKey) next[sourceParentKey] = sourceKeys
  return next
}
