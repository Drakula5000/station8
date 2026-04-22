import { useEffect, useState, useCallback, useRef } from 'react'
import Spreadsheet from 'react-spreadsheet'
import TldrawCanvas from './TldrawCanvas'
import {
  BoardIcon, SheetIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon, SearchIcon, CloseIcon,
  SidebarExpandIcon, TrashIcon,
} from './icons'
import './App.css'

const API = import.meta.env.VITE_API_URL || ''
const ROOT_FOLDER = '__root__'
const SIDEBAR_STORAGE_KEY = 'researchHub.sidebarCollapsed'
const DATABASE_VIEW_STORAGE_KEY = 'researchHub.databaseView'
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

function parseRoute() {
  const url = new URL(window.location.href)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const docMatch = path.match(/^\/(board|sheet)\/([^/]+)$/)
  return {
    shareToken: url.searchParams.get('share') || null,
    doc: docMatch ? { type: docMatch[1], id: docMatch[2] } : null,
  }
}

function buildUrl(doc = null, shareToken = null) {
  const pathname = doc?.type && doc?.id ? `/${doc.type}/${doc.id}` : '/'
  return shareToken ? `${pathname}?share=${encodeURIComponent(shareToken)}` : pathname
}

function docTypeLabel(type) {
  return type === 'board' ? 'Board' : 'Sheet'
}

function formatDocDate(value) {
  if (!value) return 'No timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No timestamp'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

async function fetchJson(url, options = {}, fallback = null) {
  try {
    const res = await fetch(url, { credentials: 'include', ...options })
    if (!res.ok) return fallback
    return await res.json()
  } catch {
    return fallback
  }
}

export default function App() {
  const [boards, setBoards] = useState([])
  const [sheets, setSheets] = useState([])
  const [folders, setFolders] = useState([])
  const foldersRef = useRef([])
  const [expandedFolders, setExpandedFolders] = useState({})
  const [route, setRoute] = useState(() => parseRoute())
  const [activeId, setActiveId] = useState(null)
  const activeIdRef = useRef(null)
  const [auth, setAuth] = useState({ loading: true, authenticated: false, access: null, requiresSetup: false })
  const [loginPassword, setLoginPassword] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [visitorPassword, setVisitorPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [databaseView, setDatabaseView] = useState(() => {
    try {
      return window.localStorage.getItem(DATABASE_VIEW_STORAGE_KEY) || 'list'
    } catch {
      return 'list'
    }
  })
  const homeSearchRef = useRef(null)
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
  const [workspace, setWorkspace] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copiedDocLink, setCopiedDocLink] = useState(false)
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

  const [colorMode, setColorMode] = useState(() => {
    try { return window.localStorage.getItem('s8.colorMode') || 'dark' } catch { return 'dark' }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-mode', colorMode)
    try { window.localStorage.setItem('s8.colorMode', colorMode) } catch {}
  }, [colorMode])

  const [titleMenuOpen, setTitleMenuOpen] = useState(false)

  useEffect(() => {
    if (!titleMenuOpen) return
    const close = (e) => {
      if (!e.target.closest('.pill-wrap')) setTitleMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [titleMenuOpen])

  const viewerMode = route.shareToken ? 'share' : auth.access
  const readOnly = viewerMode === 'visitor' || viewerMode === 'share'
  const ownerMode = viewerMode === 'owner'
  const showSidebar = ownerMode

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

  useEffect(() => {
    try {
      window.localStorage.setItem(DATABASE_VIEW_STORAGE_KEY, databaseView)
    } catch {
      // Ignore storage failures; database view can fall back to per-session.
    }
  }, [databaseView])

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!ownerMode) setSidebarCollapsed(true)
  }, [ownerMode])

  const updateAuthStatus = useCallback(async () => {
    setAuth(current => ({ ...current, loading: true }))
    const data = await fetchJson(`${API}/api/auth/status`, {}, {})
    setAuth({
      loading: false,
      authenticated: Boolean(data?.authenticated),
      access: data?.access || null,
      requiresSetup: Boolean(data?.requires_setup),
    })
  }, [])

  useEffect(() => {
    updateAuthStatus()
  }, [updateAuthStatus])

  const navigate = useCallback((doc = null, { replace = false } = {}) => {
    const nextUrl = buildUrl(doc, route.shareToken)
    const currentUrl = `${window.location.pathname}${window.location.search}`
    if (currentUrl !== nextUrl) {
      window.history[replace ? 'replaceState' : 'pushState']({}, '', nextUrl)
    }
    setRoute({ shareToken: route.shareToken, doc })
  }, [route.shareToken])

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
    const next = { type, id }
    setActiveId(next)
    navigate(next)
  }, [expandFolderPath, navigate])

  const goToDatabaseHome = useCallback(() => {
    setActiveId(null)
    navigate(null)
  }, [navigate])

  const refresh = useCallback(async () => {
    if (auth.loading) return
    if (!auth.authenticated && !route.shareToken) return
    if (!viewerMode) return

    const currentActiveId = activeIdRef.current

    if (viewerMode === 'share') {
      const data = await fetchJson(`${API}/api/share/${route.shareToken}`, {}, null)
      if (!data) return
      const nextBoards = data.boards || []
      const nextSheets = data.sheets || []
      const nextFolders = data.workspace?.folders || []
      const scopedDoc = route.doc?.type === 'board'
        ? nextBoards.find(item => item.id === route.doc.id)
        : route.doc?.type === 'sheet'
        ? nextSheets.find(item => item.id === route.doc.id)
        : null
      let nextActive = null
      if (scopedDoc) {
        nextActive = route.doc
      } else if (data.share?.scope_type === 'board' && nextBoards[0]) {
        nextActive = { type: 'board', id: nextBoards[0].id }
      } else if (data.share?.scope_type === 'sheet' && nextSheets[0]) {
        nextActive = { type: 'sheet', id: nextSheets[0].id }
      }

      setBoards(nextBoards)
      setSheets(nextSheets)
      setFolders(nextFolders)
      setExpandedFolders((current) => {
        const next = { ...current }
        for (const folder of nextFolders) {
          if (!(folder.id in next)) next[folder.id] = true
        }
        return next
      })
      setWorkspace(data.workspace || null)
      setActiveId(nextActive)
      if (nextActive?.type === 'board') {
        const board = nextBoards.find(item => item.id === nextActive.id)
        if (board?.folder_id) expandFolderPath(board.folder_id, nextFolders)
      } else if (nextActive?.type === 'sheet') {
        const sheet = nextSheets.find(item => item.id === nextActive.id)
        if (sheet?.folder_id) expandFolderPath(sheet.folder_id, nextFolders)
      }
      return
    }

    const prefix = viewerMode === 'visitor' ? 'visitor/' : ''
    const [bs, ss, ws] = await Promise.all([
      fetchJson(`${API}/api/${prefix}boards`, {}, []),
      fetchJson(`${API}/api/${prefix}sheets`, {}, []),
      fetchJson(`${API}/api/${prefix}workspace`, {}, null),
    ])

    const nextBoards = Array.isArray(bs) ? bs : []
    const nextSheets = Array.isArray(ss) ? ss : []
    const nextFolders = ws?.folders || []
    const routedDoc = route.doc?.type === 'board'
      ? nextBoards.find(item => item.id === route.doc.id)
      : route.doc?.type === 'sheet'
      ? nextSheets.find(item => item.id === route.doc.id)
      : null
    const nextActive = routedDoc
      ? route.doc
      : viewerMode === 'visitor'
      ? null
      : pickNextActiveDoc(currentActiveId, nextBoards, nextSheets)

    setBoards(nextBoards)
    setSheets(nextSheets)
    setFolders(nextFolders)
    setExpandedFolders((current) => {
      const next = { ...current }
      for (const folder of nextFolders) {
        if (!(folder.id in next)) next[folder.id] = true
      }
      return next
    })
    setWorkspace(ws)
    if (ownerMode && ws && !ws.owner && !ownerPromptDismissed) setOwnerPromptOpen(true)
    setActiveId(nextActive)
    if (nextActive?.type === 'board') {
      const board = nextBoards.find(item => item.id === nextActive.id)
      if (board?.folder_id) expandFolderPath(board.folder_id, nextFolders)
    } else if (nextActive?.type === 'sheet') {
      const sheet = nextSheets.find(item => item.id === nextActive.id)
      if (sheet?.folder_id) expandFolderPath(sheet.folder_id, nextFolders)
    }
  }, [auth.authenticated, auth.loading, expandFolderPath, ownerMode, ownerPromptDismissed, route.doc, route.shareToken, viewerMode])

  useEffect(() => {
    refresh()
  }, [refresh])

  const loadSheet = useCallback(async (id) => {
    const url = viewerMode === 'share'
      ? `${API}/api/share/${route.shareToken}/sheet/${id}`
      : viewerMode === 'visitor'
      ? `${API}/api/visitor/sheets/${id}`
      : `${API}/api/sheets/${id}`
    const data = await fetchJson(url, {}, null)
    if (!data) return
    setSheetData(data.data && data.data.length ? data.data : DEFAULT_SHEET)
  }, [route.shareToken, viewerMode])

  const saveSheet = useCallback(async (data) => {
    if (readOnly) return
    if (!activeId || activeId.type !== 'sheet') return
    await fetch(`${API}/api/sheets/${activeId.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    })
  }, [activeId, readOnly])

  const scheduleSaveSheet = useCallback((nextData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveSheet(nextData), 800)
  }, [saveSheet])

  useEffect(() => {
    if (!activeId || activeId.type !== 'sheet') return
    loadSheet(activeId.id)
  }, [activeId, loadSheet])

  const showDatabaseHome = readOnly && !activeId

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        if (showDatabaseHome) {
          homeSearchRef.current?.focus()
          return
        }
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
  }, [showDatabaseHome])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    if (!viewerMode) return
    const url = viewerMode === 'share'
      ? `${API}/api/share/${route.shareToken}/search`
      : viewerMode === 'visitor'
      ? `${API}/api/visitor/search`
      : `${API}/api/search`

    const t = setTimeout(async () => {
      const data = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      }, null)
      if (data) setResults(data.hits || [])
    }, 200)
    return () => clearTimeout(t)
  }, [query, route.shareToken, viewerMode])

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
    const board = await fetchJson(`${API}/api/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder_id: normalizeFolderValue(newBoardFolderId) }),
    }, null)
    if (!board) return
    setBoards(bs => [board, ...bs])
    if (board.folder_id) expandFolderPath(board.folder_id)
    openDocument('board', board.id, board.folder_id)
    setNewBoardOpen(false)
  }

  const createSheet = async () => {
    const name = newSheetName.trim()
    if (!name) return
    const sheet = await fetchJson(`${API}/api/sheets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder_id: normalizeFolderValue(newSheetFolderId) }),
    }, null)
    if (!sheet) return
    setSheets(ss => [sheet, ...ss])
    if (sheet.folder_id) expandFolderPath(sheet.folder_id)
    openDocument('sheet', sheet.id, sheet.folder_id)
    setNewSheetOpen(false)
  }

  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    const parentId = normalizeFolderValue(newFolderParentId)
    const folder = await fetchJson(`${API}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id: parentId }),
    }, null)
    if (!folder) return
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
    const updated = await fetchJson(`${API}/api/${endpoint}/${activeId.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: normalizeFolderValue(nextFolderValue) }),
    }, null)
    if (!updated) return
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

  const handleLogout = async () => {
    try {
      const res = await fetch(`${API}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error('logout failed')
      setBoards([])
      setSheets([])
      setFolders([])
      setActiveId(null)
      setQuery('')
      setResults([])
      setWorkspace(null)
      navigate(null, { replace: true })
      await updateAuthStatus()
    } catch {
      setErrorMessage('Could not log out right now.')
      setErrorVisible(true)
    }
  }

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
    const updated = await fetchJson(`${API}/api/${endpoint}/${activeId.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: tagsStr }),
    }, null)
    if (!updated) return
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
    if ((activeDoc.tags || []).includes(t)) {
      setTagInput('')
      setTagInputOpen(false)
      return
    }
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

  const databaseItems = query.trim()
    ? results.map((hit, index) => {
      const doc = hit.kind === 'sheet'
        ? sheets.find(item => item.id === hit.doc_id)
        : boards.find(item => item.id === hit.doc_id)
      if (!doc) return null
      return {
        key: `${hit.doc_id}-${index}`,
        type: hit.kind === 'sheet' ? 'sheet' : 'board',
        docId: hit.doc_id,
        name: hit.doc_name,
        snippet: hit.snippet,
        source: hit.source,
        createdAt: doc.created_at,
        folderPath: buildFolderPath(doc.folder_id, folderById),
        tags: doc.tags || [],
      }
    }).filter(Boolean)
    : sortDocs([
      ...boards.map(board => ({ ...board, type: 'board' })),
      ...sheets.map(sheet => ({ ...sheet, type: 'sheet' })),
    ]).map(doc => ({
      key: doc.id,
      type: doc.type,
      docId: doc.id,
      name: doc.name,
      snippet: doc.type === 'board'
        ? 'Canvas board ready for notes, frames, and visual research.'
        : 'Structured sheet available for sorting, tracking, and synthesis.',
      source: docTypeLabel(doc.type),
      createdAt: doc.created_at,
      folderPath: buildFolderPath(doc.folder_id, folderById),
      tags: doc.tags || [],
    }))

  const saveOwner = async () => {
    const name = ownerInput.trim()
    if (!name) return
    const updated = await fetchJson(`${API}/api/workspace`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: name }),
    }, null)
    if (!updated) return
    setWorkspace(updated)
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
      const res = await fetch(`${API}${endpoint}`, { method: 'DELETE', credentials: 'include' })
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
        if (activeId?.id === deleteTarget.id) goToDatabaseHome()
      } else if (deleteTarget.type === 'sheet') {
        setSheets(ss => ss.filter(s => s.id !== deleteTarget.id))
        if (activeId?.id === deleteTarget.id) goToDatabaseHome()
      }
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
      setDeleteMode('move')
    } catch {
      showError('Delete failed')
    }
  }

  const submitLogin = useCallback(async () => {
    const password = loginPassword.trim()
    if (!password) return
    setAuthBusy(true)
    setAuthError('')
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAuthError(data.error || 'Login failed')
        return
      }
      setLoginPassword('')
      await updateAuthStatus()
    } finally {
      setAuthBusy(false)
    }
  }, [loginPassword, updateAuthStatus])

  const submitSetup = useCallback(async () => {
    if (ownerPassword.length < 6 || visitorPassword.length < 6) return
    setAuthBusy(true)
    setAuthError('')
    try {
      const res = await fetch(`${API}/api/auth/setup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_password: ownerPassword,
          visitor_password: visitorPassword,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAuthError(data.error || 'Setup failed')
        return
      }
      setOwnerPassword('')
      setVisitorPassword('')
      await updateAuthStatus()
    } finally {
      setAuthBusy(false)
    }
  }, [ownerPassword, updateAuthStatus, visitorPassword])

  if (auth.loading) {
    return <AccessGate loading />
  }

  if (!auth.authenticated) {
    return (
      <AccessGate
        requiresSetup={auth.requiresSetup}
        authBusy={authBusy}
        authError={authError}
        loginPassword={loginPassword}
        ownerPassword={ownerPassword}
        visitorPassword={visitorPassword}
        route={route}
        onLoginPasswordChange={setLoginPassword}
        onOwnerPasswordChange={setOwnerPassword}
        onVisitorPasswordChange={setVisitorPassword}
        onSubmitLogin={submitLogin}
        onSubmitSetup={submitSetup}
      />
    )
  }

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}${readOnly ? ' app-viewer' : ''}`}>
      {showSidebar && (
        <aside className="sidebar" id="workspace-sidebar" aria-hidden={sidebarCollapsed}>
          {/* Header — brand only, no collapse button (pill handles it) */}
          <div className="sidebar-head">
            <span className="sidebar-brand">Station 8</span>
          </div>

          {/* Actions */}
          <div className="sidebar-actions">
            <button className="sidebar-action" onClick={openNewFolderModal} type="button">
              <FolderIcon /> Folder
            </button>
            <button className="sidebar-action" onClick={openNewBoardModal} type="button">
              <BoardIcon /> Board
            </button>
            <button className="sidebar-action" onClick={openNewSheetModal} type="button">
              <SheetIcon /> Sheet
            </button>
          </div>

          <div className="sb-section-row"><div className="sb-section">Workspace</div></div>
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
                  <button className="sb-add" onClick={() => setTagFilter(null)} title="Clear filter" type="button">
                    <CloseIcon />
                  </button>
                )}
              </div>
              <div className="sb-tags">
                {allTags.map(([t, count]) => {
                  const c = tagColor(t)
                  const active = tagFilter === t
                  return (
                    <button key={t} className="sb-tag"
                      style={{ background: active ? c.border : c.bg, color: active ? '#fff' : c.fg, borderColor: c.border }}
                      onClick={() => filterByTag(t)} type="button">
                      #{t} · {count}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="sb-section-row"><div className="sb-section">Search</div></div>
          <button className="search-btn" onClick={() => setSearchOpen(true)} type="button">
            <span className="search-btn-label"><SearchIcon /> Search</span>
            <span className="kbd">⌘F</span>
          </button>

          {/* Sticky footer */}
          <div className="sidebar-footer">
            <button
              className="sidebar-mode-btn"
              onClick={() => setColorMode(m => m === 'dark' ? 'light' : 'dark')}
              title={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              type="button"
            >
              {colorMode === 'dark' ? '◑ Light mode' : '◑ Dark mode'}
            </button>
            <button className="sidebar-logout-btn" onClick={handleLogout} type="button">
              Log out
            </button>
          </div>
        </aside>
      )}

      <main className="canvas-wrap">
        {showDatabaseHome ? (
          <DatabaseHome
            workspace={workspace}
            query={query}
            onQueryChange={setQuery}
            databaseView={databaseView}
            onDatabaseViewChange={setDatabaseView}
            items={databaseItems}
            tagColor={tagColor}
            onOpenItem={openDocument}
            onLogout={handleLogout}
            searchRef={homeSearchRef}
          />
        ) : (
          <>
            {/* Floating pill — owner view, board open */}
            {ownerMode && activeDoc && (
              <div className="pill-wrap">
                <div className="pill">
                  {sidebarCollapsed && (
                    <button
                      className="pill-icon-btn"
                      onClick={() => setSidebarCollapsed(false)}
                      aria-label="Show sidebar"
                      type="button"
                    >
                      <SidebarExpandIcon />
                    </button>
                  )}
                  {sidebarCollapsed && <div className="pill-sep" />}
                  <button
                    className="pill-title-btn"
                    onClick={() => setTitleMenuOpen(o => !o)}
                    type="button"
                  >
                    {activeDoc.name}
                    <span className="pill-chevron">▾</span>
                  </button>
                  {saveState === 'saving' && <span className="pill-saving" />}
                  {saveState === 'error' && <span className="pill-error">!</span>}
                </div>

                {titleMenuOpen && (
                  <div className="title-menu">
                    <button className="title-menu-item" onClick={() => { setShareOpen(true); setTitleMenuOpen(false) }} type="button">
                      Share workspace
                    </button>
                    <button
                      className="title-menu-item"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}`)
                        setTitleMenuOpen(false)
                      }}
                      type="button"
                    >
                      Copy board link
                    </button>
                    {activeDoc && activeDocType && (
                      <>
                        <div className="title-menu-sep" />
                        <button
                          className="title-menu-item title-menu-danger"
                          onClick={() => { openDeleteDialog({ ...activeDoc, type: activeDocType }); setTitleMenuOpen(false) }}
                          type="button"
                        >
                          Delete board…
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Pill — sidebar collapsed, no active doc */}
            {ownerMode && !activeDoc && sidebarCollapsed && (
              <div className="pill-wrap">
                <div className="pill">
                  <button
                    className="pill-icon-btn"
                    onClick={() => setSidebarCollapsed(false)}
                    aria-label="Show sidebar"
                    type="button"
                  >
                    <SidebarExpandIcon />
                  </button>
                </div>
              </div>
            )}

            <div className="work-area">
              {activeId?.type === 'board' && (
                <TldrawCanvas
                  key={activeId.id}
                  boardId={activeId.id}
                  readOnly={readOnly}
                  viewerMode={viewerMode}
                  shareSlug={route.shareToken}
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
              {!activeId && ownerMode && (
                <div className="empty-main">
                  <div>
                    <div className="big">Nothing open</div>
                    <div className="small">Create folders, boards, and sheets to organize your research.</div>
                    <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <button className="cta" onClick={openNewFolderModal} type="button">New folder</button>
                      <button className="cta" onClick={openNewBoardModal} type="button">New board</button>
                      <button className="cta" onClick={openNewSheetModal} type="button">New sheet</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {newBoardOpen && (
        <Modal onClose={() => setNewBoardOpen(false)} title="New board">
          <input
            autoFocus
            value={newBoardName}
            onChange={e => setNewBoardName(e.target.value)}
            placeholder="Name this board"
            onKeyDown={e => { if (e.key === 'Enter') createBoard() }}
          />
          <FolderField label="Create in" value={newBoardFolderId} options={folderOptions} onChange={setNewBoardFolderId} />
          <ModalFooter onCancel={() => setNewBoardOpen(false)} onConfirm={createBoard} disabled={!newBoardName.trim()} />
        </Modal>
      )}

      {newSheetOpen && (
        <Modal onClose={() => setNewSheetOpen(false)} title="New sheet">
          <input
            autoFocus
            value={newSheetName}
            onChange={e => setNewSheetName(e.target.value)}
            placeholder="Name this sheet"
            onKeyDown={e => { if (e.key === 'Enter') createSheet() }}
          />
          <FolderField label="Create in" value={newSheetFolderId} options={folderOptions} onChange={setNewSheetFolderId} />
          <ModalFooter onCancel={() => setNewSheetOpen(false)} onConfirm={createSheet} disabled={!newSheetName.trim()} />
        </Modal>
      )}

      {newFolderOpen && (
        <Modal onClose={() => setNewFolderOpen(false)} title="New folder">
          <input
            autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="Name this folder"
            onKeyDown={e => { if (e.key === 'Enter') createFolder() }}
          />
          <FolderField label="Parent folder" value={newFolderParentId} options={folderOptions} onChange={setNewFolderParentId} />
          <ModalFooter onCancel={() => setNewFolderOpen(false)} onConfirm={createFolder} disabled={!newFolderName.trim()} />
        </Modal>
      )}

      {shareOpen && workspace && (
        <Modal onClose={() => setShareOpen(false)} title="Share your research">
          <div className="share-body">
            <div className="share-desc">
              These links use the visitor password gate. Visitors land in the database view by default, and deep links can open a specific board or sheet directly.
            </div>
            <div className="share-url-row">
              <input
                readOnly
                className="share-url"
                value={`${window.location.origin}/`}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn-primary"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/`).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
                type="button"
              >
                {copied ? 'Copied' : 'Copy home'}
              </button>
            </div>
            {activeDoc && activeDocType && (
              <div className="share-url-row">
                <input
                  readOnly
                  className="share-url"
                  value={`${window.location.origin}/${activeDocType}/${activeDoc.id}`}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  className="btn-primary"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/${activeDocType}/${activeDoc.id}`).then(() => {
                      setCopiedDocLink(true)
                      setTimeout(() => setCopiedDocLink(false), 1500)
                    })
                  }}
                  type="button"
                >
                  {copiedDocLink ? 'Copied' : `Copy ${activeDocType}`}
                </button>
              </div>
            )}
            <div className="share-owner-row">
              <label>Your display name:</label>
              <input
                className="share-owner-input"
                value={workspace.owner || ''}
                onChange={(e) => setWorkspace(w => ({ ...w, owner: e.target.value }))}
                onBlur={async (e) => {
                  const updated = await fetchJson(`${API}/api/workspace`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ owner: e.target.value }),
                  }, null)
                  if (updated) setWorkspace(updated)
                }}
              />
            </div>
          </div>
        </Modal>
      )}

      {ownerPromptOpen && (
        <Modal onClose={skipOwner} title="What's your name?">
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            This shows on visitor links so people know who shared the workspace.
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
          <input
            autoFocus
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search across everything…"
          />
          <div className="hint">Text, shapes, sticky notes, sheet cells, OCR — across all boards and sheets.</div>
          <div className="results">
            {results.map((r, i) => (
              <div
                key={i}
                className="result"
                onClick={() => {
                  if (r.kind === 'sheet') {
                    const sheet = sheets.find(item => item.id === r.doc_id)
                    openDocument('sheet', r.doc_id, sheet?.folder_id)
                  } else {
                    const board = boards.find(item => item.id === r.doc_id)
                    openDocument('board', r.doc_id, board?.folder_id)
                  }
                  setSearchOpen(false)
                }}
              >
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

function AccessGate({
  loading = false,
  requiresSetup = false,
  authBusy = false,
  authError = '',
  loginPassword = '',
  ownerPassword = '',
  visitorPassword = '',
  route,
  onLoginPasswordChange,
  onOwnerPasswordChange,
  onVisitorPasswordChange,
  onSubmitLogin,
  onSubmitSetup,
}) {
  if (loading) {
    return (
      <div className="auth-shell">
        <div className="auth-card auth-card-loading">
          <div className="auth-kicker">Station 8</div>
          <div className="auth-title">Loading access state…</div>
        </div>
      </div>
    )
  }

  const directLabel = route?.doc ? `${docTypeLabel(route.doc.type)} link` : 'Workspace'

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-kicker">Station 8</div>
        <h1 className="auth-title">{requiresSetup ? 'Set up access' : 'Enter the workspace'}</h1>
        <p className="auth-copy">
          {requiresSetup
            ? 'Create the owner and visitor passwords. After setup, the same password field routes people into owner or visitor mode automatically.'
            : `${directLabel} is protected. Enter either the owner password or the visitor password to continue.`}
        </p>

        {requiresSetup ? (
          <div className="auth-form">
            <label className="auth-label">
              <span>Owner password</span>
              <input
                type="password"
                value={ownerPassword}
                onChange={(e) => onOwnerPasswordChange(e.target.value)}
                placeholder="At least 6 characters"
              />
            </label>
            <label className="auth-label">
              <span>Visitor password</span>
              <input
                type="password"
                value={visitorPassword}
                onChange={(e) => onVisitorPasswordChange(e.target.value)}
                placeholder="At least 6 characters"
              />
            </label>
            <button className="auth-submit" onClick={onSubmitSetup} disabled={authBusy || ownerPassword.length < 6 || visitorPassword.length < 6} type="button">
              {authBusy ? 'Setting up…' : 'Save passwords'}
            </button>
          </div>
        ) : (
          <div className="auth-form">
            <label className="auth-label">
              <span>Password</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => onLoginPasswordChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSubmitLogin() }}
                placeholder="Owner or visitor password"
              />
            </label>
            <button className="auth-submit" onClick={onSubmitLogin} disabled={authBusy || !loginPassword.trim()} type="button">
              {authBusy ? 'Entering…' : 'Enter Station 8'}
            </button>
          </div>
        )}

        {authError && <div className="auth-error">{authError}</div>}
      </div>
    </div>
  )
}

function DatabaseHome({
  workspace,
  query,
  onQueryChange,
  databaseView,
  onDatabaseViewChange,
  items,
  tagColor,
  onOpenItem,
  onLogout,
  searchRef,
}) {
  return (
    <div className="database-home">
      <div className="database-topbar">
        <div className="database-title-block">
          <div className="database-kicker">Station 8</div>
          <div className="database-title">{workspace?.name || 'Research Database'}</div>
        </div>
        <label className="database-search">
          <SearchIcon />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search every public note, board, sheet, and OCR fragment…"
          />
        </label>
        <div className="database-toggle" role="tablist" aria-label="Database layout">
          <button className={databaseView === 'list' ? 'active' : ''} onClick={() => onDatabaseViewChange('list')} type="button">List</button>
          <button className={databaseView === 'grid' ? 'active' : ''} onClick={() => onDatabaseViewChange('grid')} type="button">Grid</button>
        </div>
        <button className="topbar-logout" onClick={onLogout} type="button">Logout</button>
      </div>

      <div className={`database-results database-${databaseView}`}>
        {items.map((item) => (
          <button
            key={item.key}
            className={`database-card database-card-${databaseView}`}
            onClick={() => onOpenItem(item.type, item.docId)}
            type="button"
          >
            <div className={`database-thumb database-thumb-${item.type}`}>
              {item.type === 'board' ? <BoardIcon /> : <SheetIcon />}
              <span>{docTypeLabel(item.type)}</span>
            </div>
            <div className="database-card-body">
              <div className="database-card-title">{item.name}</div>
              <div className="database-card-snippet">{item.snippet}</div>
              <div className="database-card-meta">
                <span>{item.folderPath || 'Workspace root'}</span>
                <span>{item.source}</span>
                <span>{formatDocDate(item.createdAt)}</span>
              </div>
              {item.tags.length > 0 && (
                <div className="database-card-tags">
                  {item.tags.slice(0, 4).map((tag) => {
                    const c = tagColor(tag)
                    return (
                      <span key={tag} className="tag-pill" style={{ background: c.bg, color: c.fg }}>
                        #{tag}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </button>
        ))}
        {items.length === 0 && (
          <div className="database-empty">
            <div className="database-empty-title">Nothing public matched that search.</div>
            <div className="database-empty-copy">Clear the query or add more public material to the workspace.</div>
          </div>
        )}
      </div>
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
