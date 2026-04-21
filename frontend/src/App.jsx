import { useEffect, useState, useCallback, useRef } from 'react'
import Spreadsheet from 'react-spreadsheet'
import TldrawCanvas from './TldrawCanvas'
import {
  BoardIcon, SheetIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon, SearchIcon, CloseIcon,
  SidebarCollapseIcon, SidebarExpandIcon, TrashIcon,
} from './icons'
import './App.css'

const API = import.meta.env.VITE_API_URL || ''
const ROOT_FOLDER = '__root__'
const SIDEBAR_STORAGE_KEY = 'researchHub.sidebarCollapsed'
const DEFAULT_SHEET = [
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
]

const compareByName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
const normalizeFolderValue = (value) => value === ROOT_FOLDER ? null : (value || null)
const folderKey = (folderId) => folderId || ROOT_FOLDER

function buildFolderMap(folders) {
  const map = {}
  for (const folder of folders) map[folder.id] = folder
  return map
}

function buildFolderPath(folderId, folderById) {
  if (!folderId || !folderById[folderId]) return ''
  const segments = []
  let current = folderById[folderId]
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    segments.unshift(current.name)
    seen.add(current.id)
    current = current.parent_id ? folderById[current.parent_id] : null
  }
  return segments.join(' / ')
}

function buildFolderOptions(folders, parentId = null, depth = 0, seen = new Set()) {
  return folders
    .filter(folder => (folder.parent_id || null) === parentId)
    .sort(compareByName)
    .flatMap((folder) => {
      if (seen.has(folder.id)) return []
      const nextSeen = new Set(seen)
      nextSeen.add(folder.id)
      return [
        { value: folder.id, label: `${depth ? `${'— '.repeat(depth)}` : ''}${folder.name}` },
        ...buildFolderOptions(folders, folder.id, depth + 1, nextSeen),
      ]
    })
}

function sortDocs(items) {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'board' ? -1 : 1
    return compareByName(a, b)
  })
}

function collectFolderTree(folderId, folders) {
  const folderIds = new Set([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folderIds.has(folder.parent_id) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id)
        changed = true
      }
    }
  }
  return folderIds
}

function summarizeFolderDelete(folder, folders, boards, sheets) {
  const folderIds = collectFolderTree(folder.id, folders)
  const childFolderCount = folders.filter(item => item.parent_id === folder.id).length
  const directBoardCount = boards.filter(item => item.folder_id === folder.id).length
  const directSheetCount = sheets.filter(item => item.folder_id === folder.id).length
  const totalBoardCount = boards.filter(item => folderIds.has(item.folder_id)).length
  const totalSheetCount = sheets.filter(item => folderIds.has(item.folder_id)).length

  return {
    folderIds,
    childFolderCount,
    descendantFolderCount: folderIds.size - 1,
    directBoardCount,
    directSheetCount,
    directDocCount: directBoardCount + directSheetCount,
    totalBoardCount,
    totalSheetCount,
    totalDocCount: totalBoardCount + totalSheetCount,
    isEmpty: childFolderCount === 0 && directBoardCount === 0 && directSheetCount === 0,
  }
}

function pickNextActiveDoc(currentActiveId, boards, sheets) {
  if (currentActiveId?.type === 'board' && boards.some(item => item.id === currentActiveId.id)) {
    return currentActiveId
  }
  if (currentActiveId?.type === 'sheet' && sheets.some(item => item.id === currentActiveId.id)) {
    return currentActiveId
  }
  if (boards[0]) return { type: 'board', id: boards[0].id }
  if (sheets[0]) return { type: 'sheet', id: sheets[0].id }
  return null
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export default function App() {
  const [boards, setBoards] = useState([])
  const [sheets, setSheets] = useState([])
  const [folders, setFolders] = useState([])
  const foldersRef = useRef([])
  const [expandedFolders, setExpandedFolders] = useState({})
  const [activeId, setActiveId] = useState(null)
  const activeIdRef = useRef(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [newBoardOpen, setNewBoardOpen] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardFolderId, setNewBoardFolderId] = useState(ROOT_FOLDER)
  const [newSheetOpen, setNewSheetOpen] = useState(false)
  const [newSheetName, setNewSheetName] = useState('')
  const [newSheetFolderId, setNewSheetFolderId] = useState(ROOT_FOLDER)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderParentId, setNewFolderParentId] = useState(ROOT_FOLDER)
  const saveTimer = useRef(null)
  const [sheetData, setSheetData] = useState(DEFAULT_SHEET)
  const [tagFilter, setTagFilter] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [tagInputOpen, setTagInputOpen] = useState(false)
  const shareSlugFromUrl = new URLSearchParams(window.location.search).get('share')
  const readOnly = Boolean(shareSlugFromUrl)
  const [workspace, setWorkspace] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [ownerPromptOpen, setOwnerPromptOpen] = useState(false)
  const [ownerPromptDismissed, setOwnerPromptDismissed] = useState(false)
  const [ownerInput, setOwnerInput] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteMode, setDeleteMode] = useState('move')
  const [errorMessage, setErrorMessage] = useState(null)
  const [errorVisible, setErrorVisible] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const folderById = buildFolderMap(folders)
  const folderOptions = [{ value: ROOT_FOLDER, label: 'Workspace root' }, ...buildFolderOptions(folders)]
  const activeBoard = boards.find(b => b.id === activeId?.id)
  const activeSheet = sheets.find(s => s.id === activeId?.id)
  const activeDoc = activeBoard || activeSheet || null
  const activeDocType = activeBoard ? 'board' : activeSheet ? 'sheet' : null
  const activeFolderPath = buildFolderPath(activeDoc?.folder_id, folderById)
  const deleteImpact = deleteTarget?.type === 'folder'
    ? summarizeFolderDelete(deleteTarget, folders, boards, sheets)
    : null

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    foldersRef.current = folders
  }, [folders])

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))
    } catch {
      // Ignore storage failures; collapse state can fall back to per-session.
    }
  }, [sidebarCollapsed])

  const expandFolderPath = useCallback((folderId, folderList) => {
    if (!folderId) return
    const list = folderList || foldersRef.current
    const nextFolderById = buildFolderMap(list)
    setExpandedFolders((current) => {
      const next = { ...current }
      let cursor = folderId
      while (cursor && nextFolderById[cursor]) {
        next[cursor] = true
        cursor = nextFolderById[cursor].parent_id || null
      }
      return next
    })
  }, [])

  const openDocument = useCallback((type, id, folderId = null) => {
    if (folderId) expandFolderPath(folderId)
    setActiveId({ type, id })
  }, [expandFolderPath])

  const refresh = useCallback(async () => {
    const currentActiveId = activeIdRef.current
    if (readOnly) {
      const res = await fetch(`${API}/api/share/${shareSlugFromUrl}`)
      if (!res.ok) return
      const data = await res.json()
      setBoards(data.boards || [])
      setSheets(data.sheets || [])
      const nextFolders = data.workspace?.folders || []
      setFolders(nextFolders)
      setExpandedFolders((current) => {
        const next = { ...current }
        for (const folder of nextFolders) {
          if (!(folder.id in next)) next[folder.id] = true
        }
        return next
      })
      setWorkspace(data.workspace || null)
      const nextActive = pickNextActiveDoc(currentActiveId, data.boards || [], data.sheets || [])
      setActiveId(nextActive)
      if (nextActive?.type === 'board') {
        const board = (data.boards || []).find(item => item.id === nextActive.id)
        if (board?.folder_id) expandFolderPath(board.folder_id, nextFolders)
      } else if (nextActive?.type === 'sheet') {
        const sheet = (data.sheets || []).find(item => item.id === nextActive.id)
        if (sheet?.folder_id) expandFolderPath(sheet.folder_id, nextFolders)
      }
      return
    }
    const [bs, ss, ws] = await Promise.all([
      fetch(`${API}/api/boards`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/sheets`).then(r => r.json()).catch(() => []),
      fetch(`${API}/api/workspace`).then(r => r.json()).catch(() => null),
    ])
    setBoards(bs)
    setSheets(ss)
    const nextFolders = ws?.folders || []
    setFolders(nextFolders)
    setExpandedFolders((current) => {
      const next = { ...current }
      for (const folder of nextFolders) {
        if (!(folder.id in next)) next[folder.id] = true
      }
      return next
    })
    setWorkspace(ws)
    if (!readOnly && ws && !ws.owner && !ownerPromptDismissed) setOwnerPromptOpen(true)
    const nextActive = pickNextActiveDoc(currentActiveId, bs, ss)
    setActiveId(nextActive)
    if (nextActive?.type === 'board') {
      const board = bs.find(item => item.id === nextActive.id)
      if (board?.folder_id) expandFolderPath(board.folder_id, nextFolders)
    } else if (nextActive?.type === 'sheet') {
      const sheet = ss.find(item => item.id === nextActive.id)
      if (sheet?.folder_id) expandFolderPath(sheet.folder_id, nextFolders)
    }
  }, [expandFolderPath, readOnly, shareSlugFromUrl, ownerPromptDismissed])

  useEffect(() => {
    refresh()
  }, [refresh])

  // ── sheet load/save ──
  const loadSheet = async (id) => {
    const url = readOnly
      ? `${API}/api/share/${shareSlugFromUrl}/sheet/${id}`
      : `${API}/api/sheets/${id}`
    const res = await fetch(url)
    if (!res.ok) return
    const data = await res.json()
    setSheetData(data.data && data.data.length ? data.data : DEFAULT_SHEET)
  }

  const saveSheet = useCallback(async (data) => {
    if (readOnly) return
    if (!activeId || activeId.type !== 'sheet') return
    await fetch(`${API}/api/sheets/${activeId.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
  }, [activeId, readOnly])

  const scheduleSaveSheet = useCallback((nextData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveSheet(nextData), 800)
  }, [saveSheet])

  // ── When activeId changes, load its content ──
  useEffect(() => {
    if (!activeId || activeId.type !== 'sheet') return
    loadSheet(activeId.id)
  }, [activeId])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setNewBoardOpen(false)
        setNewSheetOpen(false)
        setNewFolderOpen(false)
        setDeleteConfirmOpen(false)
        setDeleteTarget(null)
        setDeleteMode('move')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const url = readOnly
        ? `${API}/api/share/${shareSlugFromUrl}/search`
        : `${API}/api/search`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (res.ok) {
        const data = await res.json()
        setResults(data.hits || [])
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  const openNewBoardModal = () => {
    setNewBoardName('')
    setNewBoardFolderId(activeDoc?.folder_id || ROOT_FOLDER)
    setNewBoardOpen(true)
  }

  const openNewSheetModal = () => {
    setNewSheetName('')
    setNewSheetFolderId(activeDoc?.folder_id || ROOT_FOLDER)
    setNewSheetOpen(true)
  }

  const openNewFolderModal = () => {
    setNewFolderName('')
    setNewFolderParentId(activeDoc?.folder_id || ROOT_FOLDER)
    setNewFolderOpen(true)
  }

  const createBoard = async () => {
    const name = newBoardName.trim()
    if (!name) return
    const res = await fetch(`${API}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder_id: normalizeFolderValue(newBoardFolderId) }),
    })
    const b = await res.json()
    setBoards(bs => [b, ...bs])
    if (b.folder_id) expandFolderPath(b.folder_id)
    openDocument('board', b.id, b.folder_id)
    setNewBoardOpen(false)
  }

  const createSheet = async () => {
    const name = newSheetName.trim()
    if (!name) return
    const res = await fetch(`${API}/api/sheets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder_id: normalizeFolderValue(newSheetFolderId) }),
    })
    const s = await res.json()
    setSheets(ss => [s, ...ss])
    if (s.folder_id) expandFolderPath(s.folder_id)
    openDocument('sheet', s.id, s.folder_id)
    setNewSheetOpen(false)
  }

  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    const parentId = normalizeFolderValue(newFolderParentId)
    const res = await fetch(`${API}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id: parentId }),
    })
    if (!res.ok) return
    const folder = await res.json()
    setFolders(current => [...current, folder])
    setExpandedFolders(current => ({
      ...current,
      [folder.id]: true,
      ...(parentId ? { [parentId]: true } : {}),
    }))
    if (parentId) expandFolderPath(parentId, [...folders, folder])
    setNewFolderOpen(false)
  }

  const moveActiveDoc = async (nextFolderValue) => {
    if (!activeId || readOnly) return
    const endpoint = activeId.type === 'board' ? 'boards' : 'sheets'
    const res = await fetch(`${API}/api/${endpoint}/${activeId.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: normalizeFolderValue(nextFolderValue) }),
    })
    if (!res.ok) return
    const updated = await res.json()
    if (activeId.type === 'board') {
      setBoards(bs => bs.map(b => b.id === updated.id ? updated : b))
    } else {
      setSheets(ss => ss.map(s => s.id === updated.id ? updated : s))
    }
    if (updated.folder_id) expandFolderPath(updated.folder_id)
  }

  const toggleFolder = (folderId) => {
    setExpandedFolders(current => ({ ...current, [folderId]: current[folderId] === false ? true : false }))
  }

  const openDeleteDialog = (target) => {
    setDeleteTarget(target)
    if (target.type === 'folder') {
      const impact = summarizeFolderDelete(target, folders, boards, sheets)
      setDeleteMode(impact.isEmpty ? 'delete' : 'move')
    } else {
      setDeleteMode('delete')
    }
    setDeleteConfirmOpen(true)
  }

  // ── tags ──
  const tagColor = (tag) => {
    if (!tag) return { bg: '#eee', fg: '#666', border: '#ccc' }
    let h = 0
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
    const hue = h % 360
    return { bg: `hsl(${hue}, 70%, 93%)`, fg: `hsl(${hue}, 50%, 35%)`, border: `hsl(${hue}, 55%, 55%)` }
  }

  const saveTags = async (tagsStr) => {
    if (!activeId) return
    const endpoint = activeId.type === 'board' ? 'boards' : 'sheets'
    const res = await fetch(`${API}/api/${endpoint}/${activeId.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: tagsStr }),
    })
    if (!res.ok) return
    const updated = await res.json()
    if (activeId.type === 'board') {
      setBoards(bs => bs.map(b => b.id === updated.id ? updated : b))
    } else {
      setSheets(ss => ss.map(s => s.id === updated.id ? updated : s))
    }
  }

  const removeTagFromActive = (tag) => {
    if (!activeDoc) return
    const next = (activeDoc.tags || []).filter(t => t !== tag)
    saveTags(next.join(','))
  }

  const addTagToActive = () => {
    const t = tagInput.trim().replace(/^#/, '')
    if (!t || !activeDoc) return
    if ((activeDoc.tags || []).includes(t)) { setTagInput(''); setTagInputOpen(false); return }
    const next = [...(activeDoc.tags || []), t]
    saveTags(next.join(','))
    setTagInput('')
    setTagInputOpen(false)
  }

  const allTags = (() => {
    const counts = {}
    for (const b of boards) for (const t of (b.tags || [])) counts[t] = (counts[t] || 0) + 1
    for (const s of sheets) for (const t of (s.tags || [])) counts[t] = (counts[t] || 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  })()

  const filterByTag = (tag) => {
    setTagFilter(cur => cur === tag ? null : tag)
  }

  const visibleBoards = tagFilter ? boards.filter(b => (b.tags || []).includes(tagFilter)) : boards
  const visibleSheets = tagFilter ? sheets.filter(s => (s.tags || []).includes(tagFilter)) : sheets
  const visibleDocs = sortDocs([
    ...visibleBoards.map(board => ({ ...board, type: 'board' })),
    ...visibleSheets.map(sheet => ({ ...sheet, type: 'sheet' })),
  ])

  const docsByFolder = {}
  for (const doc of visibleDocs) {
    const key = folderKey(doc.folder_id)
    if (!docsByFolder[key]) docsByFolder[key] = []
    docsByFolder[key].push(doc)
  }

  const foldersByParent = {}
  for (const folder of [...folders].sort(compareByName)) {
    const key = folderKey(folder.parent_id)
    if (!foldersByParent[key]) foldersByParent[key] = []
    foldersByParent[key].push(folder)
  }

  const folderHasVisibleContent = (folderId) => {
    const childDocs = docsByFolder[folderKey(folderId)] || []
    const childFolders = foldersByParent[folderKey(folderId)] || []
    return childDocs.length > 0 || childFolders.some(folder => folderHasVisibleContent(folder.id))
  }

  const renderDocItem = (doc, depth = 0) => {
    const active = activeId?.type === doc.type && activeId.id === doc.id
    return (
      <div key={`${doc.type}-${doc.id}`} className={`tree-item-shell ${active ? 'active' : ''}`}>
        <button
          className={`sb-item sb-item-main tree-row tree-doc ${active ? 'active' : ''}`}
          style={{ paddingLeft: `${10 + depth * 18}px` }}
          onClick={() => openDocument(doc.type, doc.id, doc.folder_id)}
          type="button"
        >
          {doc.type === 'board' ? <BoardIcon /> : <SheetIcon />}
          <span className="sb-item-label">{doc.name}</span>
        </button>
        {!readOnly && (
          <div className="item-actions">
            <button
              className="tree-delete-btn"
              aria-label={`Delete ${doc.name}`}
              onClick={(e) => {
                e.stopPropagation()
                openDeleteDialog({ ...doc })
              }}
              title={`Delete ${doc.name}`}
              type="button"
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderFolderNode = (folder, depth = 0) => {
    if (tagFilter && !folderHasVisibleContent(folder.id)) return null
    const expanded = expandedFolders[folder.id] !== false
    const childFolders = foldersByParent[folderKey(folder.id)] || []
    const childDocs = docsByFolder[folderKey(folder.id)] || []
    return (
      <div key={folder.id}>
        <div className="tree-item-shell">
          <button
            className={`sb-item sb-item-main tree-row tree-folder ${expanded ? 'folder-open' : ''}`}
            style={{ paddingLeft: `${10 + depth * 18}px` }}
            onClick={() => toggleFolder(folder.id)}
            type="button"
          >
            <span className={`tree-chevron ${expanded ? 'open' : ''}`}><ChevronRightIcon /></span>
            {expanded ? <FolderOpenIcon /> : <FolderIcon />}
            <span className="sb-item-label">{folder.name}</span>
          </button>
          {!readOnly && (
            <div className="item-actions">
              <button
                className="tree-delete-btn"
                aria-label={`Delete ${folder.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  openDeleteDialog({ ...folder, type: 'folder' })
                }}
                title={`Delete ${folder.name}`}
                type="button"
              >
                <TrashIcon />
              </button>
            </div>
          )}
        </div>
        {expanded && (
          <>
            {childFolders.map(child => renderFolderNode(child, depth + 1))}
            {childDocs.map(doc => renderDocItem(doc, depth + 1))}
            {!tagFilter && childFolders.length === 0 && childDocs.length === 0 && (
              <div className="sb-empty tree-empty" style={{ paddingLeft: `${28 + (depth + 1) * 18}px` }}>
                Empty folder
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const rootFolders = foldersByParent[ROOT_FOLDER] || []
  const rootDocs = docsByFolder[ROOT_FOLDER] || []
  const hasWorkspaceItems = rootFolders.some(folder => !tagFilter || folderHasVisibleContent(folder.id)) || rootDocs.length > 0

  const saveOwner = async () => {
    const name = ownerInput.trim()
    if (!name) return
    await fetch(`${API}/api/workspace`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: name }),
    })
    setWorkspace(w => ({ ...w, owner: name }))
    setOwnerPromptDismissed(true)
    setOwnerPromptOpen(false)
  }

  const skipOwner = () => {
    setOwnerPromptDismissed(true)
    setOwnerPromptOpen(false)
  }

  const showError = (message) => {
    setErrorMessage(message)
    setErrorVisible(true)
    setTimeout(() => {
      setErrorVisible(false)
      setTimeout(() => setErrorMessage(null), 300)
    }, 3000)
  }

  const handleDelete = async () => {
    if (!deleteTarget || readOnly) return
    try {
      const endpoint = deleteTarget.type === 'folder'
        ? `/api/folders/${deleteTarget.id}?mode=${deleteMode}`
        : deleteTarget.type === 'board'
        ? `/api/boards/${deleteTarget.id}`
        : `/api/sheets/${deleteTarget.id}`
      const res = await fetch(`${API}${endpoint}`, { method: 'DELETE' })
      if (!res.ok) {
        showError(res.status === 404 ? 'Item not found' : 'Delete failed')
        return
      }
      if (deleteTarget.type === 'folder') {
        if (deleteMode === 'delete' && deleteImpact?.folderIds.has(activeDoc?.folder_id)) {
          setActiveId(null)
        }
        await refresh()
      } else if (deleteTarget.type === 'board') {
        setBoards(bs => bs.filter(b => b.id !== deleteTarget.id))
        if (activeId?.id === deleteTarget.id) setActiveId(null)
      } else if (deleteTarget.type === 'sheet') {
        setSheets(ss => ss.filter(s => s.id !== deleteTarget.id))
        if (activeId?.id === deleteTarget.id) setActiveId(null)
      }
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
      setDeleteMode('move')
    } catch {
      showError('Delete failed')
    }
  }

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      {readOnly && (
        <div className="readonly-banner">
          <strong>Read-only view.</strong> {workspace?.name || 'Research'} shared by {workspace?.owner || 'the owner'}. You can browse and search; you cannot edit.
        </div>
      )}
      <aside
        className="sidebar"
        id="workspace-sidebar"
        aria-hidden={sidebarCollapsed}
      >
        <div className="sidebar-header">
          <div className="brand">{workspace?.name || 'Research'}</div>
          <button
            className="sidebar-chrome-btn"
            onClick={() => setSidebarCollapsed(true)}
            type="button"
            aria-controls="workspace-sidebar"
            aria-expanded="true"
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <SidebarCollapseIcon />
          </button>
        </div>

        {!readOnly && (
          <div className="sidebar-actions">
            <button className="sidebar-action" onClick={openNewFolderModal} type="button"><FolderIcon /> Folder</button>
            <button className="sidebar-action" onClick={openNewBoardModal} type="button"><BoardIcon /> Board</button>
            <button className="sidebar-action" onClick={openNewSheetModal} type="button"><SheetIcon /> Sheet</button>
          </div>
        )}

        <div className="sb-section-row">
          <div className="sb-section">Workspace</div>
        </div>
        <div className="workspace-tree">
          {rootFolders.map(folder => renderFolderNode(folder))}
          {rootDocs.length > 0 && rootFolders.length > 0 && <div className="sb-subsection">Unfiled</div>}
          {rootDocs.map(doc => renderDocItem(doc))}
          {!hasWorkspaceItems && (
            <div className="sb-empty">{tagFilter ? 'No matching items' : 'Nothing here yet'}</div>
          )}
        </div>

        {allTags.length > 0 && (
          <>
            <div className="sb-section-row">
              <div className="sb-section">Tags</div>
              {tagFilter && (
                <button className="sb-add" onClick={() => setTagFilter(null)} title="Clear filter" type="button"><CloseIcon /></button>
              )}
            </div>
            <div className="sb-tags">
              {allTags.map(([t, count]) => {
                const c = tagColor(t)
                const active = tagFilter === t
                return (
                  <button
                    key={t}
                    className="sb-tag"
                    style={{
                      background: active ? c.border : c.bg,
                      color: active ? '#fff' : c.fg,
                      borderColor: c.border,
                    }}
                    onClick={() => filterByTag(t)}
                    type="button"
                  >
                    #{t} · {count}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div className="sb-section-row">
          <div className="sb-section">Search</div>
        </div>
        <button className="search-btn" onClick={() => setSearchOpen(true)} type="button">
          <span className="search-btn-label"><SearchIcon /> Search</span>
          <span className="kbd">⌘F</span>
        </button>
      </aside>

      <main className="canvas-wrap">
        <div className="topbar">
          {sidebarCollapsed && (
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed(false)}
              type="button"
              aria-controls="workspace-sidebar"
              aria-expanded="false"
              aria-label="Show sidebar"
              title="Show sidebar"
            >
              <SidebarExpandIcon />
            </button>
          )}
          <div className="crumb-col">
            {activeDoc && (
              <div className="crumb-path">
                {activeFolderPath || 'Workspace root'}
              </div>
            )}
            <div className="crumb">
              {activeBoard ? activeBoard.name : activeSheet ? activeSheet.name : 'Select or create something'}
            </div>
            {activeDoc && (
              <div className="doc-tags">
                {!readOnly && (
                  <label className="folder-field">
                    <span className="folder-field-label">Folder</span>
                    <select
                      className="folder-select"
                      value={activeDoc.folder_id || ROOT_FOLDER}
                      onChange={(e) => moveActiveDoc(e.target.value)}
                    >
                      {folderOptions.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {(activeDoc.tags || []).map(t => {
                  const c = tagColor(t)
                  return (
                    <span key={t} className="tag-pill" style={{ background: c.bg, color: c.fg }}>
                      #{t}
                      {!readOnly && <button className="tag-pill-remove" onClick={() => removeTagFromActive(t)} title="Remove tag" type="button">×</button>}
                    </span>
                  )
                })}
                {!readOnly && (tagInputOpen ? (
                  <input
                    autoFocus
                    className="tag-input"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onBlur={() => { addTagToActive() }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addTagToActive()
                      if (e.key === 'Escape') { setTagInput(''); setTagInputOpen(false) }
                    }}
                    placeholder="tag-name"
                  />
                ) : (
                  <button className="tag-add" onClick={() => setTagInputOpen(true)} type="button">+ tag</button>
                ))}
              </div>
            )}
          </div>
          {!readOnly && (
            <>
              <span className={`save-indicator save-${saveState}`} aria-live="polite">
                {saveState === 'saving' && '· saving…'}
                {saveState === 'saved' && '✓ saved'}
                {saveState === 'error' && '! save failed'}
              </span>
              {activeDoc && activeDocType && (
                <button
                  className="topbar-delete-btn"
                  onClick={() => openDeleteDialog({ ...activeDoc, type: activeDocType })}
                  type="button"
                >
                  <TrashIcon />
                  Delete...
                </button>
              )}
              <button className="share-btn" onClick={() => setShareOpen(true)} type="button">Share</button>
            </>
          )}
        </div>

        <div className="work-area">
          {activeId?.type === 'board' && (
            <TldrawCanvas
              key={activeId.id}
              boardId={activeId.id}
              readOnly={readOnly}
              shareSlug={shareSlugFromUrl}
              onSaveState={setSaveState}
            />
          )}
          {activeId?.type === 'sheet' && (
            <div className="sheet-wrap" key={activeId.id}>
              {readOnly ? (
                <ReadOnlySheet data={sheetData} />
              ) : (
                <Spreadsheet
                  data={sheetData}
                  onChange={(d) => { setSheetData(d); scheduleSaveSheet(d) }}
                />
              )}
            </div>
          )}
          {!activeId && (
            <div className="empty-main">
              <div>
                <div className="big">Nothing open</div>
                <div className="small">Create folders, boards, and sheets to organize your research.</div>
                <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {!readOnly && <>
                    <button className="cta" onClick={openNewFolderModal} type="button">New folder</button>
                    <button className="cta" onClick={openNewBoardModal} type="button">New board</button>
                    <button className="cta" onClick={openNewSheetModal} type="button">New sheet</button>
                  </>}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {newBoardOpen && (
        <Modal onClose={() => setNewBoardOpen(false)} title="New board">
          <input autoFocus value={newBoardName}
                 onChange={e => setNewBoardName(e.target.value)}
                 placeholder="Name this board"
                 onKeyDown={e => { if (e.key === 'Enter') createBoard() }} />
          <FolderField label="Create in" value={newBoardFolderId} options={folderOptions} onChange={setNewBoardFolderId} />
          <ModalFooter onCancel={() => setNewBoardOpen(false)} onConfirm={createBoard} disabled={!newBoardName.trim()} />
        </Modal>
      )}

      {newSheetOpen && (
        <Modal onClose={() => setNewSheetOpen(false)} title="New sheet">
          <input autoFocus value={newSheetName}
                 onChange={e => setNewSheetName(e.target.value)}
                 placeholder="Name this sheet"
                 onKeyDown={e => { if (e.key === 'Enter') createSheet() }} />
          <FolderField label="Create in" value={newSheetFolderId} options={folderOptions} onChange={setNewSheetFolderId} />
          <ModalFooter onCancel={() => setNewSheetOpen(false)} onConfirm={createSheet} disabled={!newSheetName.trim()} />
        </Modal>
      )}

      {newFolderOpen && (
        <Modal onClose={() => setNewFolderOpen(false)} title="New folder">
          <input autoFocus value={newFolderName}
                 onChange={e => setNewFolderName(e.target.value)}
                 placeholder="Name this folder"
                 onKeyDown={e => { if (e.key === 'Enter') createFolder() }} />
          <FolderField label="Parent folder" value={newFolderParentId} options={folderOptions} onChange={setNewFolderParentId} />
          <ModalFooter onCancel={() => setNewFolderOpen(false)} onConfirm={createFolder} disabled={!newFolderName.trim()} />
        </Modal>
      )}

      {shareOpen && workspace && (
        <Modal onClose={() => setShareOpen(false)} title="Share your research">
          <div className="share-body">
            <div className="share-desc">
              Anyone with this link can view and search everything in your workspace. They cannot edit.
            </div>
            <div className="share-url-row">
              <input
                readOnly
                className="share-url"
                value={`${window.location.origin}${window.location.pathname}?share=${workspace.public_slug}`}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn-primary"
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?share=${workspace.public_slug}`
                  navigator.clipboard.writeText(url).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
                type="button"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="share-owner-row">
              <label>Your display name:</label>
              <input
                className="share-owner-input"
                value={workspace.owner || ''}
                onChange={(e) => setWorkspace(w => ({ ...w, owner: e.target.value }))}
                onBlur={async (e) => {
                  await fetch(`${API}/api/workspace`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ owner: e.target.value }),
                  })
                }}
              />
            </div>
          </div>
        </Modal>
      )}

      {ownerPromptOpen && (
        <Modal onClose={skipOwner} title="What's your name?">
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            This shows on shared links so viewers know who shared the workspace.
          </p>
          <input
            autoFocus
            value={ownerInput}
            onChange={e => setOwnerInput(e.target.value)}
            placeholder="Your name"
            onKeyDown={e => { if (e.key === 'Enter' && ownerInput.trim()) saveOwner() }}
          />
          <div className="modal-footer">
            <button className="btn-ghost" onClick={skipOwner} type="button">Skip</button>
            <button className="btn-primary" onClick={saveOwner} disabled={!ownerInput.trim()} type="button">Save</button>
          </div>
        </Modal>
      )}

      {deleteConfirmOpen && deleteTarget && (
        <Modal onClose={() => { setDeleteConfirmOpen(false); setDeleteTarget(null) }} title={`Delete ${deleteTarget.type}`}>
          <div className="delete-dialog-body">
            <p className="delete-dialog-copy">
              {deleteTarget.type === 'folder'
                ? <>Choose what should happen to <strong>{deleteTarget.name}</strong>.</>
                : <>Delete <strong>{deleteTarget.name}</strong>? This permanently removes it.</>}
            </p>

            {deleteTarget.type === 'folder' && deleteImpact && !deleteImpact.isEmpty && (
              <div className="delete-mode-list">
                <button
                  className={`delete-mode-card ${deleteMode === 'move' ? 'selected' : ''}`}
                  onClick={() => setDeleteMode('move')}
                  type="button"
                >
                  <div className="delete-mode-title">Delete folder only</div>
                  <div className="delete-mode-copy">
                    Move {pluralize(deleteImpact.directDocCount, 'item')} to the parent folder and keep {pluralize(deleteImpact.childFolderCount, 'subfolder')} in place.
                  </div>
                  <div className="delete-mode-badge">Recommended</div>
                </button>
                <button
                  className={`delete-mode-card danger ${deleteMode === 'delete' ? 'selected' : ''}`}
                  onClick={() => setDeleteMode('delete')}
                  type="button"
                >
                  <div className="delete-mode-title">Delete folder and contents</div>
                  <div className="delete-mode-copy">
                    Remove {pluralize(deleteImpact.descendantFolderCount, 'nested folder')} and {pluralize(deleteImpact.totalDocCount, 'item')} inside this folder tree.
                  </div>
                </button>
              </div>
            )}

            {deleteTarget.type === 'folder' && deleteImpact?.isEmpty && (
              <p className="delete-dialog-note">
                This folder is empty, so only the folder itself will be removed.
              </p>
            )}

            {deleteTarget.type !== 'folder' && (
              <p className="delete-dialog-note">
                {deleteTarget.type === 'board'
                  ? 'Its canvas data will be removed, and uploaded images tied only to this board will be cleaned up too.'
                  : 'Its spreadsheet data will be removed.'}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn-ghost" onClick={() => { setDeleteConfirmOpen(false); setDeleteTarget(null); setDeleteMode('move') }} type="button">Cancel</button>
            <button className="btn-primary btn-danger" onClick={handleDelete} type="button">
              {deleteTarget.type === 'folder' && deleteMode === 'move' ? 'Delete folder' : 'Delete permanently'}
            </button>
          </div>
        </Modal>
      )}

      {searchOpen && (
        <Modal onClose={() => setSearchOpen(false)} wide>
          <input autoFocus className="search-input" value={query}
                 onChange={e => setQuery(e.target.value)}
                 placeholder="Search across everything…" />
          <div className="hint">Text, shapes, sticky notes, sheet cells, OCR — across all boards and sheets.</div>
          <div className="results">
            {results.map((r, i) => (
              <div key={i} className="result" onClick={() => {
                if (r.kind === 'sheet') {
                  const sheet = sheets.find(item => item.id === r.doc_id)
                  openDocument('sheet', r.doc_id, sheet?.folder_id)
                } else {
                  const board = boards.find(item => item.id === r.doc_id)
                  openDocument('board', r.doc_id, board?.folder_id)
                }
                setSearchOpen(false)
              }}>
                <div className="result-title">{r.doc_name}</div>
                <div className="result-snippet">{r.snippet}</div>
                <div className="result-meta">{r.source}</div>
              </div>
            ))}
            {query && results.length === 0 && <div className="result-empty">No hits</div>}
          </div>
        </Modal>
      )}

      {errorVisible && errorMessage && (
        <div className="error-toast">{errorMessage}</div>
      )}
    </div>
  )
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) onClose() }}>
      <div className={`modal ${wide ? 'modal-search' : ''}`}>
        {title && <div className="modal-title">{title}</div>}
        {children}
      </div>
    </div>
  )
}

function ModalFooter({ onCancel, onConfirm, disabled }) {
  return (
    <div className="modal-footer">
      <button className="btn-ghost" onClick={onCancel} type="button">Cancel</button>
      <button className="btn-primary" onClick={onConfirm} disabled={disabled} type="button">Create</button>
    </div>
  )
}

function FolderField({ label, value, onChange, options }) {
  return (
    <label className="modal-field">
      <span className="modal-field-label">{label}</span>
      <select className="folder-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function ReadOnlySheet({ data }) {
  return (
    <table className="ro-sheet">
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => <td key={j}>{cell?.value || ''}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
