from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker not found')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{label}: end marker not found')
    end += len(end_marker)
    return text[:start] + replacement + text[end:]


# ── Frontend wiring ─────────────────────────────────────────────────────────
app_path = Path('frontend/src/App.jsx')
app = app_path.read_text()

app = replace_once(
    app,
    "import { loadFolderExpansionState, mergeFolderExpansionDefaults, saveFolderExpansionState } from './sidebarFolderState'\nimport './styles/index.css'",
    "import { loadFolderExpansionState, mergeFolderExpansionDefaults, saveFolderExpansionState } from './sidebarFolderState'\nimport { appendSidebarDocument, reorderSidebarDocuments, sidebarDocumentKey, sortSidebarDocuments } from './sidebarDocumentOrder'\nimport './styles/index.css'",
    'document-order import',
)

app = replace_once(
    app,
    "  const [dropTargetFolderId, setDropTargetFolderId] = useState(null)\n  const [externalPdfDragActive, setExternalPdfDragActive] = useState(false)",
    "  const [dropTargetFolderId, setDropTargetFolderId] = useState(null)\n  const [dropTargetDoc, setDropTargetDoc] = useState(null)\n  const [externalPdfDragActive, setExternalPdfDragActive] = useState(false)",
    'document drop-target state',
)

app = replace_once(
    app,
    """  const docsByKind = useMemo(() => ({
    board: boards,
    gdoc: gdocs,
    gsheet: gsheets,
    report: reports,
    pdf: pdfs,
  }), [boards, gdocs, gsheets, reports, pdfs])
  const activeDoc = activeId
""",
    """  const docsByKind = useMemo(() => ({
    board: boards,
    gdoc: gdocs,
    gsheet: gsheets,
    report: reports,
    pdf: pdfs,
  }), [boards, gdocs, gsheets, reports, pdfs])
  const allSidebarDocs = useMemo(
    () => DOC_KINDS.flatMap(kind => (docsByKind[kind] || []).map(item => ({ ...item, type: kind }))),
    [docsByKind],
  )
  const activeDoc = activeId
""",
    'all sidebar documents',
)

app = replace_once(
    app,
    """  const setDocsForKind = (kind, updater) => {
    if (kind === 'board') setBoards(updater)
    else if (kind === 'gdoc') setGdocs(updater)
    else if (kind === 'gsheet') setGsheets(updater)
    else if (kind === 'report') setReports(updater)
    else if (kind === 'pdf') setPdfs(updater)
  }

  const startRename = (item, isFolder) => {
""",
    """  const setDocsForKind = (kind, updater) => {
    if (kind === 'board') setBoards(updater)
    else if (kind === 'gdoc') setGdocs(updater)
    else if (kind === 'gsheet') setGsheets(updater)
    else if (kind === 'report') setReports(updater)
    else if (kind === 'pdf') setPdfs(updater)
  }

  const persistSidebarOrder = async (nextOrder, previousOrder) => {
    setWorkspace(current => ({ ...(current || {}), sidebar_order: nextOrder }))
    const updated = await fetchJsonPatch(`${API}/api/workspace`, { sidebar_order: nextOrder }, null)
    if (!updated) {
      setWorkspace(current => ({ ...(current || {}), sidebar_order: previousOrder }))
      showError('Could not save the new sidebar order.')
      return false
    }
    setWorkspace(updated)
    return true
  }

  const startRename = (item, isFolder) => {
""",
    'sidebar-order persistence helper',
)

app = replace_once(
    app,
    """  const docsByFolder = {}
  for (const doc of visibleDocs) {
    const key = folderKey(doc.folder_id)
    if (!docsByFolder[key]) docsByFolder[key] = []
    docsByFolder[key].push(doc)
  }

  const foldersByParent = {}
""",
    """  const docsByFolder = {}
  for (const doc of visibleDocs) {
    const key = folderKey(doc.folder_id)
    if (!docsByFolder[key]) docsByFolder[key] = []
    docsByFolder[key].push(doc)
  }
  const sidebarOrder = workspace?.sidebar_order || {}
  for (const [parentId, items] of Object.entries(docsByFolder)) {
    docsByFolder[parentId] = sortSidebarDocuments(items, sidebarOrder, parentId)
  }

  const foldersByParent = {}
""",
    'sidebar-order sorting',
)

app = replace_once(
    app,
    """    const isDragging = dragItem?.type === doc.type && dragItem.id === doc.id
    const isRenaming = renameTarget?.id === doc.id && renameTarget.type === doc.type
    return (
      <div key={`${doc.type}-${doc.id}`} className={`tree-item-shell ${active ? 'active' : ''}${isDragging ? ' is-dragging' : ''}${isRenaming ? ' is-renaming' : ''}`}>
""",
    """    const isDragging = dragItem?.type === doc.type && dragItem.id === doc.id
    const isRenaming = renameTarget?.id === doc.id && renameTarget.type === doc.type
    const dropPosition = dropTargetDoc?.key === sidebarDocumentKey(doc) ? dropTargetDoc.position : null
    return (
      <div key={`${doc.type}-${doc.id}`} className={`tree-item-shell ${active ? 'active' : ''}${isDragging ? ' is-dragging' : ''}${isRenaming ? ' is-renaming' : ''}${dropPosition ? ` is-drop-${dropPosition}` : ''}`}>
""",
    'document drop-position class',
)

app = replace_once(
    app,
    """            onDragEnd={handleItemDragEnd}
            onDragOver={(event) => handleDocExternalDragOver(event, doc)}
            onDragStart={(event) => handleItemDragStart(event, doc)}
            onDrop={(event) => handleDocExternalDrop(event, doc)}
""",
    """            onDragEnd={handleItemDragEnd}
            onDragOver={(event) => handleDocDragOver(event, doc)}
            onDragStart={(event) => handleItemDragStart(event, doc)}
            onDrop={(event) => handleDocDrop(event, doc)}
""",
    'document drag handlers',
)

app = replace_once(
    app,
    """  const clearDragState = () => {
    dragItemRef.current = null
    setDragItem(null)
    setDropTargetFolderId(null)
  }
""",
    """  const clearDragState = () => {
    dragItemRef.current = null
    setDragItem(null)
    setDropTargetFolderId(null)
    setDropTargetDoc(null)
  }
""",
    'clear document drop state',
)

app = replace_once(
    app,
    """  const finishExternalPdfDrag = () => {
    externalDragDepthRef.current = 0
    clearFolderHoverExpand()
    setExternalPdfDragActive(false)
    setDropTargetFolderId(null)
  }
""",
    """  const finishExternalPdfDrag = () => {
    externalDragDepthRef.current = 0
    clearFolderHoverExpand()
    setExternalPdfDragActive(false)
    setDropTargetFolderId(null)
    setDropTargetDoc(null)
  }
""",
    'external drag cleanup',
)

start_marker = "  const handleItemDragStart = (event, item) => {"
end_marker = """  const handleWorkspaceDragLeave = (event) => {
    if (externalPdfDragActive) return
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetFolderId(null)
  }
"""
new_drag_block = """  const handleItemDragStart = (event, item) => {
    if (readOnly) return
    const payload = item.type === 'folder'
      ? { type: 'folder', id: item.id, name: item.name, parent_id: item.parent_id || null }
      : { type: item.type, id: item.id, name: item.name, folder_id: item.folder_id || null }
    dragItemRef.current = payload
    setDragItem(payload)
    setDropTargetFolderId(null)
    setDropTargetDoc(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${payload.type}:${payload.id}`)
  }

  const handleItemDragEnd = () => {
    clearDragState()
  }

  const handleFolderDragOver = (event, folderId) => {
    if (isExternalFileDrag(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      setExternalPdfDragActive(true)
      scheduleFolderHoverExpand(folderId)
      setDropTargetDoc(null)
      if (dropTargetFolderId !== folderId) setDropTargetFolderId(folderId)
      return
    }
    const dragged = dragItemRef.current
    const canPlace = dragged?.type === 'folder'
      ? canDropIntoFolder(dragged, folderId)
      : Boolean(dragged)
    if (!canPlace) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetDoc(null)
    if (dropTargetFolderId !== folderId) setDropTargetFolderId(folderId)
  }

  const moveDraggedItem = async (targetFolderId) => {
    const dragged = dragItemRef.current
    if (!dragged) return
    if (dragged.type === 'folder' && !canDropIntoFolder(dragged, targetFolderId)) {
      clearDragState()
      return
    }

    const normalizedTargetId = targetFolderId || null
    const sameFolder = dragged.type !== 'folder' && (dragged.folder_id || null) === normalizedTargetId
    let updated = dragged

    if (dragged.type === 'folder' || !sameFolder) {
      const url = dragged.type === 'folder'
        ? `${API}/api/folders/${dragged.id}`
        : `${API}/api/${DOC_KIND_API[dragged.type]}/${dragged.id}`
      const body = dragged.type === 'folder'
        ? { parent_id: normalizedTargetId }
        : { folder_id: normalizedTargetId }
      updated = await fetchJsonPatch(url, body)
      if (!updated) {
        showError(`Could not move ${dragged.name}.`)
        clearDragState()
        return
      }
    }

    if (dragged.type === 'folder') {
      setFolders(current => current.map(folder => folder.id === updated.id ? updated : folder))
    } else {
      if (!sameFolder) {
        setDocsForKind(dragged.type, items => items.map(i => i.id === updated.id ? updated : i))
      }
      const previousOrder = workspace?.sidebar_order || {}
      const nextOrder = appendSidebarDocument(previousOrder, allSidebarDocs, dragged, normalizedTargetId)
      const saved = await persistSidebarOrder(nextOrder, previousOrder)
      if (!saved && !sameFolder) await refresh()
    }

    if (normalizedTargetId) expandFolderPath(normalizedTargetId)
    clearDragState()
  }

  const handleFolderDrop = async (event, folderId) => {
    if (isExternalFileDrag(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      const files = Array.from(event.dataTransfer.files || [])
      finishExternalPdfDrag()
      if (files.length) await uploadDroppedPdfs(files, folderId)
      return
    }
    const dragged = dragItemRef.current
    const canPlace = dragged?.type === 'folder'
      ? canDropIntoFolder(dragged, folderId)
      : Boolean(dragged)
    if (!canPlace) return
    event.preventDefault()
    event.stopPropagation()
    await moveDraggedItem(folderId)
  }

  const handleDocDragOver = (event, doc) => {
    if (isExternalFileDrag(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      setExternalPdfDragActive(true)
      clearFolderHoverExpand()
      setDropTargetDoc(null)
      const targetFolderId = doc.folder_id || ROOT_FOLDER
      if (dropTargetFolderId !== targetFolderId) setDropTargetFolderId(targetFolderId)
      return
    }

    const dragged = dragItemRef.current
    if (!dragged || dragged.type === 'folder' || sidebarDocumentKey(dragged) === sidebarDocumentKey(doc)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTargetFolderId(null)
    setDropTargetDoc({ key: sidebarDocumentKey(doc), position })
  }

  const handleDocDrop = async (event, doc) => {
    if (isExternalFileDrag(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      const files = Array.from(event.dataTransfer.files || [])
      const targetFolderId = doc.folder_id || null
      finishExternalPdfDrag()
      if (files.length) await uploadDroppedPdfs(files, targetFolderId)
      return
    }

    const dragged = dragItemRef.current
    if (!dragged || dragged.type === 'folder' || sidebarDocumentKey(dragged) === sidebarDocumentKey(doc)) {
      clearDragState()
      return
    }
    event.preventDefault()
    event.stopPropagation()

    const rect = event.currentTarget.getBoundingClientRect()
    const fallbackPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    const position = dropTargetDoc?.key === sidebarDocumentKey(doc)
      ? dropTargetDoc.position
      : fallbackPosition
    const targetFolderId = doc.folder_id || null
    const previousOrder = workspace?.sidebar_order || {}
    const nextOrder = reorderSidebarDocuments(previousOrder, allSidebarDocs, dragged, doc, position)
    const movedFolders = (dragged.folder_id || null) !== targetFolderId

    if (movedFolders) {
      const updated = await fetchJsonPatch(
        `${API}/api/${DOC_KIND_API[dragged.type]}/${dragged.id}`,
        { folder_id: targetFolderId },
        null,
      )
      if (!updated) {
        showError(`Could not move ${dragged.name}.`)
        clearDragState()
        return
      }
      setDocsForKind(dragged.type, items => items.map(item => item.id === updated.id ? updated : item))
    }

    const saved = await persistSidebarOrder(nextOrder, previousOrder)
    if (!saved && movedFolders) await refresh()
    clearDragState()
  }

  const handleWorkspaceDragOver = (event) => {
    if (isExternalFileDrag(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      setExternalPdfDragActive(true)
      clearFolderHoverExpand()
      setDropTargetDoc(null)
      if (dropTargetFolderId !== ROOT_FOLDER) setDropTargetFolderId(ROOT_FOLDER)
      return
    }
    const dragged = dragItemRef.current
    const canPlace = dragged?.type === 'folder'
      ? canDropIntoFolder(dragged, null)
      : Boolean(dragged)
    if (!canPlace) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetDoc(null)
    if (dropTargetFolderId !== ROOT_FOLDER) setDropTargetFolderId(ROOT_FOLDER)
  }

  const handleWorkspaceDrop = async (event) => {
    if (isExternalFileDrag(event.dataTransfer)) {
      event.preventDefault()
      event.stopPropagation()
      const files = Array.from(event.dataTransfer.files || [])
      finishExternalPdfDrag()
      if (files.length) await uploadDroppedPdfs(files, null)
      return
    }
    const dragged = dragItemRef.current
    const canPlace = dragged?.type === 'folder'
      ? canDropIntoFolder(dragged, null)
      : Boolean(dragged)
    if (!canPlace) return
    event.preventDefault()
    await moveDraggedItem(null)
  }

  const handleWorkspaceDragLeave = (event) => {
    if (externalPdfDragActive) return
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetFolderId(null)
    setDropTargetDoc(null)
  }
"""
app = replace_between(app, start_marker, end_marker, new_drag_block, 'internal drag block')
app_path.write_text(app)


# ── Backend persistence ─────────────────────────────────────────────────────
server_path = Path('server.py')
server = server_path.read_text()

server = replace_once(
    server,
    "GLOBAL_STORAGE_BASENAMES = frozenset({'auth.json', 'accounts.json'})\nSECONDARY_ACCOUNT_PASSWORD_ENV = 'S8_SECONDARY_PASSWORD'",
    "GLOBAL_STORAGE_BASENAMES = frozenset({'auth.json', 'accounts.json'})\nSIDEBAR_ROOT_KEY = '__root__'\nSIDEBAR_DOC_KEY_RE = re.compile(r'^(?:board|gdoc|gsheet|report|pdf):[A-Za-z0-9_-]{1,128}$')\nSECONDARY_ACCOUNT_PASSWORD_ENV = 'S8_SECONDARY_PASSWORD'",
    'sidebar-order constants',
)

server = replace_once(
    server,
    """def _normalize_workspace(ws):
""",
    """def _normalize_sidebar_order(value, folder_ids):
    if not isinstance(value, dict):
        return {}
    valid_parents = set(folder_ids) | {SIDEBAR_ROOT_KEY}
    normalized = {}
    for raw_parent, raw_items in value.items():
        parent = str(raw_parent or '').strip()
        if parent not in valid_parents or not isinstance(raw_items, list):
            continue
        items = []
        seen = set()
        for raw_key in raw_items[:10000]:
            key = str(raw_key or '').strip()
            if not SIDEBAR_DOC_KEY_RE.fullmatch(key) or key in seen:
                continue
            seen.add(key)
            items.append(key)
        if items:
            normalized[parent] = items
    return normalized


def _normalize_workspace(ws):
""",
    'sidebar-order normalizer',
)

server = replace_once(
    server,
    """    ws['folders'] = normalized
    return ws
""",
    """    ws['folders'] = normalized
    ws['sidebar_order'] = _normalize_sidebar_order(ws.get('sidebar_order'), valid_ids)
    return ws
""",
    'workspace sidebar-order normalization',
)

server = replace_once(
    server,
    """    ws = _get_workspace()
    ws = dict(ws)
    ws['folders'] = _visitor_visible_folders(ws)
    profile = _current_access_profile()
""",
    """    ws = _get_workspace()
    ws = dict(ws)
    ws['folders'] = _visitor_visible_folders(ws)
    ws.pop('sidebar_order', None)
    profile = _current_access_profile()
""",
    'visitor sidebar-order privacy',
)

server = replace_once(
    server,
    """    if 'owner' in data:
        ws['owner'] = (data['owner'] or '').strip()
    _save(WORKSPACE_FILE, ws)
    return jsonify(ws)
""",
    """    if 'owner' in data:
        ws['owner'] = (data['owner'] or '').strip()
    if 'sidebar_order' in data:
        ws['sidebar_order'] = data.get('sidebar_order')
    ws = _normalize_workspace(ws)
    _save(WORKSPACE_FILE, ws)
    return jsonify(ws)
""",
    'workspace sidebar-order patch',
)
server_path.write_text(server)


# ── Existing sidebar visual language ────────────────────────────────────────
css_path = Path('frontend/src/styles/layout.css')
css = css_path.read_text()
css = replace_once(
    css,
    """.tree-item-shell.is-dragging {
  opacity: 0.46;
}
.sb-item {
""",
    """.tree-item-shell.is-dragging {
  opacity: 0.46;
}
.tree-item-shell.is-drop-before::before,
.tree-item-shell.is-drop-after::after {
  content: '';
  position: absolute;
  left: 0.5rem;
  right: 0.5rem;
  height: 0.125rem;
  border-radius: 999px;
  background: var(--s8-accent);
  box-shadow: 0 0 0.375rem var(--s8-accent-dim);
  pointer-events: none;
  z-index: 3;
}
.tree-item-shell.is-drop-before::before { top: -0.0625rem; }
.tree-item-shell.is-drop-after::after { bottom: -0.0625rem; }
.sb-item {
""",
    'document insertion indicator styles',
)
css_path.write_text(css)
