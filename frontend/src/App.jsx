import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from 'react'
import TldrawCanvas from './TldrawCanvas'
import {
  BoardIcon, SheetIcon, DocIcon, GoogleLogoIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon, SearchIcon, CloseIcon, ThemeToggleIcon, LogoutIcon,
  SidebarExpandIcon, TrashIcon, LockIcon, UnlockIcon, PlusIcon, GlobeIcon, PinIcon,
} from './icons'
import './styles/index.css'

const API = import.meta.env.VITE_API_URL || ''
const ROOT_FOLDER = '__root__'
const SIDEBAR_STORAGE_KEY = 's8.sidebarCollapsed'

// Aurora is the only theme — ensure data-theme is always absent so Aurora
// tokens (on html[data-mode]) take effect.
if (typeof document !== 'undefined') {
  try {
    document.documentElement.removeAttribute('data-theme')
  } catch { /* pre-render environments have no document */ }
}

// Doc-type kinds. `gdoc`/`gsheet` are Google Drive-backed (iframe embeds);
// `board` is the tldraw canvas.
const DOC_KINDS = ['board', 'gdoc', 'gsheet']

const DOC_KIND_API = {
  board: 'boards',
  gdoc: 'gdocs',
  gsheet: 'gsheets',
}

const DOC_KIND_LABEL = {
  board: 'Board',
  gdoc: 'Doc',
  gsheet: 'Sheet',
}

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

const DOC_KIND_ORDER = { board: 0, gdoc: 1, gsheet: 2 }

function sortDocs(items) {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return (DOC_KIND_ORDER[a.type] ?? 99) - (DOC_KIND_ORDER[b.type] ?? 99)
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

function summarizeFolderDelete(folder, folders, docsByKind) {
  const folderIds = collectFolderTree(folder.id, folders)
  const childFolderCount = folders.filter(item => item.parent_id === folder.id).length
  const direct = {}
  const total = {}
  let directDocCount = 0
  let totalDocCount = 0
  for (const kind of DOC_KINDS) {
    const items = docsByKind[kind] || []
    direct[kind] = items.filter(item => item.folder_id === folder.id).length
    total[kind] = items.filter(item => folderIds.has(item.folder_id)).length
    directDocCount += direct[kind]
    totalDocCount += total[kind]
  }
  return {
    folderIds,
    childFolderCount,
    descendantFolderCount: folderIds.size - 1,
    direct,
    total,
    directDocCount,
    totalDocCount,
    isEmpty: childFolderCount === 0 && directDocCount === 0,
  }
}

function pickNextActiveDoc(currentActiveId, docsByKind) {
  if (currentActiveId && docsByKind[currentActiveId.type]?.some(item => item.id === currentActiveId.id)) {
    return currentActiveId
  }
  for (const kind of DOC_KINDS) {
    const items = docsByKind[kind] || []
    if (items[0]) return { type: kind, id: items[0].id }
  }
  return null
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function parseRoute() {
  const url = new URL(window.location.href)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const docMatch = path.match(/^\/(board|gdoc|gsheet)\/([^/]+)$/)
  const shareToken = url.searchParams.get('share') || null

  // Known routes: /, /board/<id>, /gdoc/<id>, /gsheet/<id>
  // Everything else redirects to /
  if (path !== '/' && !docMatch) {
    window.history.replaceState({}, '', '/')
    return { shareToken, doc: null }
  }

  return {
    shareToken,
    doc: docMatch ? { type: docMatch[1], id: docMatch[2] } : null,
  }
}

function buildUrl(doc = null, shareToken = null) {
  const pathname = doc?.type && doc?.id ? `/${doc.type}/${doc.id}` : '/'
  return shareToken ? `${pathname}?share=${encodeURIComponent(shareToken)}` : pathname
}

function docTypeLabel(type) {
  return DOC_KIND_LABEL[type] || 'Item'
}

function docKindIcon(type) {
  if (type === 'board') return <BoardIcon />
  if (type === 'gdoc') return <DocIcon />
  if (type === 'gsheet') return <SheetIcon />
  return <BoardIcon />
}

const KIND_PILL_LABEL = {
  alt:    'ALT TEXT',
  ocr:    'OCR',
  text:   'TEXT',
  frame:  'SECTION',
  sheet:  'CELL',
  gdoc:   'DOC',
  gsheet: 'SHEET',
  name:   'NAME',
  tag:    'TAG',
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function renderHighlightedSnippet(snippet, query) {
  const trimmed = (snippet || '').trim()
  const q = (query || '').trim()
  if (!q) return <>"{trimmed}"</>
  const parts = trimmed.split(new RegExp(`(${escapeRegex(q)})`, 'ig'))
  const qLower = q.toLowerCase()
  return (
    <>
      "
      {parts.map((part, idx) => (
        part.toLowerCase() === qLower
          ? <mark key={idx} className="result-mark">{part}</mark>
          : <span key={idx}>{part}</span>
      ))}
      "
    </>
  )
}

function formatDocDate(value) {
  if (!value) return 'No timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No timestamp'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays < 0) {
    // Future-dated (unlikely but possible in dev) — show full date.
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
  }
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  // After a month, absolute date with year so "Apr 23" never has ambiguous year context.
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' }
  ).format(date)
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

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function fetchJsonPost(url, payload, fallback = null) {
  return fetchJson(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }, fallback)
}

function fetchJsonPatch(url, payload, fallback = null) {
  return fetchJson(url, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(payload) }, fallback)
}

function clearStorageByPrefix(storage, prefix) {
  try {
    const keysToRemove = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(prefix)) keysToRemove.push(k)
    }
    keysToRemove.forEach((k) => storage.removeItem(k))
  } catch { /* ignore */ }
}

export default function App() {
  const [boards, setBoards] = useState([])
  const [gdocs, setGdocs] = useState([])
  const [gsheets, setGsheets] = useState([])
  const [folders, setFolders] = useState([])
  const foldersRef = useRef([])
  const [expandedFolders, setExpandedFolders] = useState({})
  const [route, setRoute] = useState(() => parseRoute())
  // Initialize activeId from URL immediately to avoid flash of database home on refresh
  const [activeId, setActiveId] = useState(() => {
    const r = parseRoute()
    return r.doc ? r.doc : null
  })
  const activeIdRef = useRef(null)
  const [auth, setAuth] = useState({
    loading: true,
    authenticated: false,
    access: null,
    configured: true,
    setupAllowed: false,
    requiresSetup: false,
  })
  const [loginPassword, setLoginPassword] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [visitorPassword, setVisitorPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [findQuery, setFindQuery] = useState(null) // string | null — triggers FindBar in TldrawCanvas
  const [findBoards, setFindBoards] = useState([]) // ordered board IDs that matched the search
  const [searchScope, setSearchScope] = useState(null) // { boardId, boardName } | null
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const homeSearchRef = useRef(null)
  const [newBoardOpen, setNewBoardOpen] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardFolderId, setNewBoardFolderId] = useState(ROOT_FOLDER)
  const [newGDocOpen, setNewGDocOpen] = useState(false)
  const [newGDocName, setNewGDocName] = useState('')
  const [newGDocFolderId, setNewGDocFolderId] = useState(ROOT_FOLDER)
  const [newGDocUrl, setNewGDocUrl] = useState('')
  const [newGSheetOpen, setNewGSheetOpen] = useState(false)
  const [newGSheetName, setNewGSheetName] = useState('')
  const [newGSheetFolderId, setNewGSheetFolderId] = useState(ROOT_FOLDER)
  const [newGSheetUrl, setNewGSheetUrl] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderParentId, setNewFolderParentId] = useState(ROOT_FOLDER)
  const [googleAuth, setGoogleAuth] = useState({ loading: true, connected: false, email: null })
  const [driveShareState, setDriveShareState] = useState({ busy: false, message: null })
  const driveShareMessageTimer = useRef(null)
  const [driveConfig, setDriveConfig] = useState({ root_folder_id: null, root_folder_name: 'My Drive', mirror_folders: false })
  const [driveSettingsOpen, setDriveSettingsOpen] = useState(false)
  const [drivePickerOpen, setDrivePickerOpen] = useState(false)
  const [drivePicker, setDrivePicker] = useState({ loading: false, error: null, folders: [], breadcrumb: [{ id: null, name: 'My Drive' }] })
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
  const [deleteAlsoDrive, setDeleteAlsoDrive] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [errorVisible, setErrorVisible] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [dragItem, setDragItem] = useState(null)
  const dragItemRef = useRef(null)
  const [dropTargetFolderId, setDropTargetFolderId] = useState(null)
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
  // Backend wake-up state for visitor/share mode
  const [backendStatus, setBackendStatus] = useState('checking') // 'checking' | 'ready'
  const backendReadyRef = useRef(false)

  const viewerMode = route.shareToken ? 'share' : auth.access
  const readOnly = viewerMode === 'visitor' || viewerMode === 'share'

  useEffect(() => {
    if (!readOnly) {
      setBackendStatus('ready')
      backendReadyRef.current = true
      return
    }
    let cancelled = false
    const ping = async () => {
      try {
        // Ping the workspace endpoint — only resolves when the full app is ready
        const res = await fetch(`${API}/api/visitor/workspace`, { credentials: 'include' })
        if (!cancelled && res.ok) {
          const data = await res.json()
          // Only mark ready if we got a real workspace response
          if (data && !cancelled) {
            setBackendStatus('ready')
            backendReadyRef.current = true
            return
          }
        }
        if (!cancelled) setTimeout(ping, 3000)
      } catch {
        if (!cancelled) setTimeout(ping, 3000)
      }
    }
    ping()
    return () => { cancelled = true }
  }, [readOnly])

  useEffect(() => {
    if (!titleMenuOpen) return
    const close = (e) => {
      if (!e.target.closest('.pill-wrap')) setTitleMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [titleMenuOpen])

  const ownerMode = viewerMode === 'owner'
  const showSidebar = ownerMode

  const folderById = buildFolderMap(folders)
  const folderOptions = [{ value: ROOT_FOLDER, label: 'Workspace root' }, ...buildFolderOptions(folders)]
  const docsByKind = useMemo(() => ({
    board: boards,
    gdoc: gdocs,
    gsheet: gsheets,
  }), [boards, gdocs, gsheets])
  const activeDoc = activeId
    ? (docsByKind[activeId.type] || []).find(item => item.id === activeId.id) || null
    : null
  const activeDocType = activeDoc ? activeId.type : null
  const deleteImpact = deleteTarget?.type === 'folder'
    ? summarizeFolderDelete(deleteTarget, folders, docsByKind)
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
    const onPopState = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!ownerMode) setSidebarCollapsed(true)
  }, [ownerMode])

  const updateAuthStatus = useCallback(async () => {
    setAuth(current => ({ ...current, loading: true }))
    let data = null
    let backendOffline = false
    try {
      const res = await fetch(`${API}/api/auth/status`, { credentials: 'include' })
      if (res.status >= 500) {
        backendOffline = true
      } else if (res.ok) {
        data = await res.json().catch(() => null)
      }
    } catch {
      backendOffline = true
    }
    setAuth({
      loading: false,
      backendOffline,
      authenticated: Boolean(data?.authenticated),
      access: data?.access || null,
      configured: data?.configured !== false,
      setupAllowed: Boolean(data?.setup_allowed),
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

  const onFindDismiss = useCallback(() => setFindQuery(null), [])

  const findShapeIdsByBoard = useMemo(() => {
    const acc = {}
    for (const hit of results) {
      if (hit.doc_type !== 'board' || !hit.shape_id) continue
      if (!acc[hit.doc_id]) acc[hit.doc_id] = []
      if (!acc[hit.doc_id].includes(hit.shape_id)) acc[hit.doc_id].push(hit.shape_id)
    }
    return acc
  }, [results])

  const refresh = useCallback(async () => {
    if (auth.loading) return
    if (!auth.authenticated && !route.shareToken) return
    if (!viewerMode) return

    const currentActiveId = activeIdRef.current

    const applyResult = (nextDocsByKind, nextFolders, ws) => {
      setBoards(nextDocsByKind.board || [])
      setGdocs(nextDocsByKind.gdoc || [])
      setGsheets(nextDocsByKind.gsheet || [])
      setFolders(nextFolders)
      setExpandedFolders((current) => {
        const next = { ...current }
        for (const folder of nextFolders) {
          if (!(folder.id in next)) next[folder.id] = true
        }
        return next
      })
      setWorkspace(ws)
      const routedDoc = route.doc && nextDocsByKind[route.doc.type]?.find(item => item.id === route.doc.id)
      const nextActive = routedDoc
        ? route.doc
        : viewerMode === 'visitor'
        ? null
        : pickNextActiveDoc(currentActiveId, nextDocsByKind)
      setActiveId(nextActive)
      if (nextActive) {
        const item = (nextDocsByKind[nextActive.type] || []).find(d => d.id === nextActive.id)
        if (item?.folder_id) expandFolderPath(item.folder_id, nextFolders)
      }
    }

    if (viewerMode === 'share') {
      const data = await fetchJson(`${API}/api/share/${route.shareToken}`, {}, null)
      if (!data) return
      const nextDocsByKind = {
        board: data.boards || [],
        gdoc: data.gdocs || [],
        gsheet: data.gsheets || [],
      }
      applyResult(nextDocsByKind, data.workspace?.folders || [], data.workspace || null)
      return
    }

    const prefix = viewerMode === 'visitor' ? 'visitor/' : ''
    const [bs, gd, gs, ws] = await Promise.all([
      fetchJson(`${API}/api/${prefix}boards`, {}, []),
      fetchJson(`${API}/api/${prefix}gdocs`, {}, []),
      fetchJson(`${API}/api/${prefix}gsheets`, {}, []),
      fetchJson(`${API}/api/${prefix}workspace`, {}, null),
    ])

    const nextDocsByKind = {
      board: Array.isArray(bs) ? bs : [],
      gdoc: Array.isArray(gd) ? gd : [],
      gsheet: Array.isArray(gs) ? gs : [],
    }
    if (ownerMode && ws && !ws.owner && !ownerPromptDismissed) setOwnerPromptOpen(true)
    applyResult(nextDocsByKind, ws?.folders || [], ws)
  }, [auth.authenticated, auth.loading, expandFolderPath, ownerMode, ownerPromptDismissed, route.doc, route.shareToken, viewerMode])

  useEffect(() => {
    refresh()
  }, [refresh])

  const refreshGoogleAuth = useCallback(async () => {
    const data = await fetchJson(`${API}/api/google/status`, {}, null)
    setGoogleAuth({
      loading: false,
      connected: Boolean(data?.connected),
      email: data?.email || null,
    })
  }, [])

  const refreshDriveConfig = useCallback(async () => {
    const data = await fetchJson(`${API}/api/google/config`, {}, null)
    if (data) {
      setDriveConfig({
        root_folder_id: data.root_folder_id || null,
        root_folder_name: data.root_folder_name || 'My Drive',
        mirror_folders: Boolean(data.mirror_folders),
      })
    }
  }, [])

  // Single fetch + state-update for the Drive folder picker. Each call site
  // owns breadcrumb math; this just loads the children of `parentId` and
  // commits them with the provided breadcrumb.
  const loadDriveFolders = useCallback(async (parentId, nextBreadcrumb) => {
    setDrivePicker(prev => ({ ...prev, loading: true, error: null, breadcrumb: nextBreadcrumb }))
    const url = parentId
      ? `${API}/api/google/folders?parent=${encodeURIComponent(parentId)}`
      : `${API}/api/google/folders`
    const data = await fetchJson(url, {}, null)
    if (!data) {
      setDrivePicker(prev => ({ ...prev, loading: false, error: 'Could not load folders.', folders: [] }))
      return
    }
    setDrivePicker({ loading: false, error: null, folders: data.folders || [], breadcrumb: nextBreadcrumb })
  }, [])

  const openDrivePicker = useCallback(() => {
    setDrivePickerOpen(true)
    loadDriveFolders(null, [{ id: null, name: 'My Drive' }])
  }, [loadDriveFolders])

  const drivePickerEnter = (folder) => {
    loadDriveFolders(folder.id, [...drivePicker.breadcrumb, folder])
  }

  const drivePickerJumpTo = (index) => {
    const nextCrumbs = drivePicker.breadcrumb.slice(0, index + 1)
    loadDriveFolders(nextCrumbs[nextCrumbs.length - 1].id, nextCrumbs)
  }

  const saveDriveRootFolder = useCallback(async (folderId) => {
    const data = await fetchJsonPatch(`${API}/api/google/config`, { root_folder_id: folderId }, null)
    if (data) {
      setDriveConfig({
        root_folder_id: data.root_folder_id || null,
        root_folder_name: data.root_folder_name || 'My Drive',
        mirror_folders: Boolean(data.mirror_folders),
      })
      setDrivePickerOpen(false)
    }
  }, [])

  const toggleDriveMirror = useCallback(async () => {
    const next = !driveConfig.mirror_folders
    const data = await fetchJsonPatch(`${API}/api/google/config`, { mirror_folders: next }, null)
    if (data) {
      setDriveConfig({
        root_folder_id: data.root_folder_id || null,
        root_folder_name: data.root_folder_name || 'My Drive',
        mirror_folders: Boolean(data.mirror_folders),
      })
    }
  }, [driveConfig.mirror_folders])

  useEffect(() => {
    if (!auth.authenticated || !ownerMode) return
    refreshGoogleAuth()
  }, [auth.authenticated, ownerMode, refreshGoogleAuth])

  useEffect(() => {
    if (!googleAuth.connected) return
    refreshDriveConfig()
  }, [googleAuth.connected, refreshDriveConfig])

  useEffect(() => {
    // Google OAuth callback redirects back here with ?google=connected (or
    // ?google=error&reason=...). Pull the status, then strip the query so a
    // refresh doesn't keep firing the toast.
    const params = new URLSearchParams(window.location.search)
    const flag = params.get('google')
    if (!flag) return
    if (flag === 'connected') {
      refreshGoogleAuth()
    } else if (flag === 'error') {
      const reason = params.get('reason') || 'unknown'
      console.warn('Google OAuth failed:', reason)
    }
    params.delete('google')
    params.delete('reason')
    const next = params.toString()
    const cleanUrl = window.location.pathname + (next ? `?${next}` : '') + window.location.hash
    window.history.replaceState({}, '', cleanUrl)
  }, [refreshGoogleAuth])

  const showDatabaseHome = readOnly && !activeId
  const scanSurfaceKey = showDatabaseHome
    ? `${viewerMode || 'anon'}:dashboard:${route.shareToken || 'direct'}`
    : `${viewerMode || 'anon'}:${activeId?.type || 'workspace'}:${activeId?.id || 'home'}:${route.shareToken || 'direct'}`
  const mainClassName = `canvas-wrap${showDatabaseHome ? '' : ' s8-grid'}`

  useEffect(() => {
    const onKey = (e) => {
      // ⌘K / Ctrl+K is the only Station 8 search shortcut. We deliberately do
      // not bind ⌘F: the browser's find-in-page handler runs at a layer page
      // JS can't reliably intercept (especially when a cross-origin Google
      // iframe has focus), so trying to override it produces inconsistent
      // results. Same pattern Notion / Linear / Slack use for the same reason.
      // The visitor pill exposes a search button for users who don't know ⌘K.
      const searchHotkey = (e.metaKey || e.ctrlKey) && e.key === 'k'
      if (searchHotkey) {
        e.preventDefault()
        if (showDatabaseHome) {
          homeSearchRef.current?.focus()
          return
        }
        if (activeId?.type === 'board') {
          const board = boards.find(b => b.id === activeId.id)
          setSearchScope(board ? { boardId: board.id, boardName: board.name } : null)
        } else {
          setSearchScope(null)
        }
        setFindQuery(null)
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setSearchScope(null)
        setNewBoardOpen(false)
        setNewGDocOpen(false)
        setNewGSheetOpen(false)
        setNewFolderOpen(false)
        setDeleteConfirmOpen(false)
        setDeleteTarget(null)
        setDeleteMode('move')
        setDeleteAlsoDrive(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showDatabaseHome])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSearchLoading(false)
      return
    }
    if (!viewerMode) return
    if (backendStatus !== 'ready') return
    const url = viewerMode === 'share'
      ? `${API}/api/share/${route.shareToken}/search`
      : viewerMode === 'visitor'
      ? `${API}/api/visitor/search`
      : `${API}/api/search`

    setSearchLoading(true)
    const t = setTimeout(async () => {
      const data = await fetchJsonPost(url, { query })
      setSearchLoading(false)
      if (data) {
        const hits = data.hits || []
        setResults(searchScope ? hits.filter(h => h.doc_id === searchScope.boardId) : hits)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, route.shareToken, viewerMode, searchScope])

  const openNewBoardModal = () => {
    setNewBoardName('')
    setNewBoardFolderId(activeDoc?.folder_id || ROOT_FOLDER)
    setNewBoardOpen(true)
  }

  const openNewGDocModal = () => {
    setNewGDocName('')
    setNewGDocUrl('')
    setNewGDocFolderId(activeDoc?.folder_id || ROOT_FOLDER)
    setNewGDocOpen(true)
  }

  const openNewGSheetModal = () => {
    setNewGSheetName('')
    setNewGSheetUrl('')
    setNewGSheetFolderId(activeDoc?.folder_id || ROOT_FOLDER)
    setNewGSheetOpen(true)
  }

  const openNewFolderModal = () => {
    setNewFolderName('')
    setNewFolderParentId(activeDoc?.folder_id || ROOT_FOLDER)
    setNewFolderOpen(true)
  }

  const createBoard = async () => {
    const name = newBoardName.trim()
    if (!name) return
    const board = await fetchJsonPost(`${API}/api/boards`, { name, folder_id: normalizeFolderValue(newBoardFolderId) })
    if (!board) return
    setBoards(bs => [board, ...bs])
    if (board.folder_id) expandFolderPath(board.folder_id)
    openDocument('board', board.id, board.folder_id)
    setNewBoardOpen(false)
  }

  const createGdoc = async () => {
    const name = newGDocName.trim()
    if (!name) return
    const item = await fetchJsonPost(`${API}/api/gdocs`, {
      name,
      folder_id: normalizeFolderValue(newGDocFolderId),
      embed_url: newGDocUrl.trim() || null,
    })
    if (!item) return
    setGdocs(items => [item, ...items])
    if (item.folder_id) expandFolderPath(item.folder_id)
    openDocument('gdoc', item.id, item.folder_id)
    setNewGDocOpen(false)
  }

  const createGsheet = async () => {
    const name = newGSheetName.trim()
    if (!name) return
    const item = await fetchJsonPost(`${API}/api/gsheets`, {
      name,
      folder_id: normalizeFolderValue(newGSheetFolderId),
      embed_url: newGSheetUrl.trim() || null,
    })
    if (!item) return
    setGsheets(items => [item, ...items])
    if (item.folder_id) expandFolderPath(item.folder_id)
    openDocument('gsheet', item.id, item.folder_id)
    setNewGSheetOpen(false)
  }

  const openGoogleConnect = () => {
    // Real OAuth: kick the browser over to /api/google/auth, which redirects
    // to Google's consent screen and bounces back to /api/google/callback,
    // which redirects back to the frontend with ?google=connected.
    window.location.href = `${API}/api/google/auth`
  }

  const disconnectGoogle = async () => {
    const data = await fetchJsonPost(`${API}/api/google/disconnect`, {})
    if (data) {
      setGoogleAuth({
        loading: false,
        connected: Boolean(data.connected),
        email: data.email || null,
      })
    }
  }

  const shareAllDrive = useCallback(async () => {
    if (driveShareState.busy) return
    setDriveShareState({ busy: true, message: null })
    const data = await fetchJsonPost(`${API}/api/google/share-all`, {})
    if (driveShareMessageTimer.current) clearTimeout(driveShareMessageTimer.current)
    let message
    if (!data) {
      message = 'Share failed'
    } else if ((data.total || 0) === 0) {
      message = 'Nothing to share'
    } else {
      const ok = data.shared || 0
      const failed = data.failed || 0
      message = failed
        ? `Shared ${ok} · ${failed} failed`
        : `Shared ${ok} ${ok === 1 ? 'item' : 'items'}`
    }
    setDriveShareState({ busy: false, message })
    driveShareMessageTimer.current = setTimeout(() => {
      setDriveShareState((cur) => (cur.busy ? cur : { busy: false, message: null }))
    }, 4000)
  }, [driveShareState.busy])

  useEffect(() => () => {
    if (driveShareMessageTimer.current) clearTimeout(driveShareMessageTimer.current)
  }, [])

  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    const parentId = normalizeFolderValue(newFolderParentId)
    const folder = await fetchJsonPost(`${API}/api/folders`, { name, parent_id: parentId })
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


  const isEffectivelyPrivate = (item, isFolder) => {
    if (item.private === true) return true
    if (item.private === false) return false
    const parentId = isFolder ? item.parent_id : item.folder_id
    let id = parentId
    const visited = new Set()
    while (id && !visited.has(id)) {
      visited.add(id)
      const f = folderById[id]
      if (!f) return false
      if (f.private === true) return true
      if (f.private === false) return false
      id = f.parent_id
    }
    return false
  }

  const setDocsForKind = (kind, updater) => {
    if (kind === 'board') setBoards(updater)
    else if (kind === 'gdoc') setGdocs(updater)
    else if (kind === 'gsheet') setGsheets(updater)
  }

  const togglePrivate = async (item, isFolder) => {
    const effective = isEffectivelyPrivate(item, isFolder)
    let newValue
    if (effective) {
      const parentId = isFolder ? item.parent_id : item.folder_id
      let ancestorPrivate = false
      let id = parentId
      const visited = new Set()
      while (id && !visited.has(id)) {
        visited.add(id)
        const f = folderById[id]
        if (!f) break
        if (f.private === true) { ancestorPrivate = true; break }
        if (f.private === false) break
        id = f.parent_id
      }
      newValue = ancestorPrivate ? false : null
    } else {
      newValue = true
    }
    const url = isFolder
      ? `${API}/api/folders/${item.id}`
      : `${API}/api/${DOC_KIND_API[item.type]}/${item.id}`
    const updated = await fetchJsonPatch(url, { private: newValue })
    if (!updated) return
    if (isFolder) {
      setFolders(fs => fs.map(f => f.id === updated.id ? updated : f))
    } else {
      setDocsForKind(item.type, items => items.map(i => i.id === updated.id ? updated : i))
    }
  }

  const toggleFolder = (folderId) => {
    setExpandedFolders(current => ({ ...current, [folderId]: current[folderId] === false ? true : false }))
  }

  const openDeleteDialog = (target) => {
    setDeleteTarget(target)
    if (target.type === 'folder') {
      const impact = summarizeFolderDelete(target, folders, docsByKind)
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
      // Wipe per-board view + cached snapshots so the next login starts fresh
      // and a different user on this machine can't peek at restricted boards.
      clearStorageByPrefix(sessionStorage, 's8.boardView.')
      clearStorageByPrefix(localStorage, 's8.boardCache.')
      setBoards([])
      setGdocs([])
      setGsheets([])
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
    if (!tag) return { bg: 'var(--hover)', fg: 'var(--text-mid)', border: 'var(--sidebar-border)' }
    let h = 0
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
    const hue = h % 360
    if (colorMode === 'dark') {
      return { bg: `hsl(${hue}, 50%, 18%)`, fg: `hsl(${hue}, 80%, 72%)`, border: `hsl(${hue}, 55%, 38%)` }
    }
    return { bg: `hsl(${hue}, 70%, 90%)`, fg: `hsl(${hue}, 50%, 28%)`, border: `hsl(${hue}, 55%, 60%)` }
  }

  const saveTags = async (tagsStr) => {
    if (!activeId) return
    const endpoint = DOC_KIND_API[activeId.type]
    if (!endpoint) return
    const updated = await fetchJsonPatch(`${API}/api/${endpoint}/${activeId.id}`, { tags: tagsStr })
    if (!updated) return
    setDocsForKind(activeId.type, items => items.map(i => i.id === updated.id ? updated : i))
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
    for (const kind of DOC_KINDS) {
      for (const item of (docsByKind[kind] || [])) {
        for (const t of (item.tags || [])) counts[t] = (counts[t] || 0) + 1
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  })()

  const filterByTag = (tag) => {
    setTagFilter(cur => cur === tag ? null : tag)
  }

  const visibleDocs = sortDocs(
    DOC_KINDS.flatMap(kind => {
      const items = docsByKind[kind] || []
      const filtered = tagFilter ? items.filter(i => (i.tags || []).includes(tagFilter)) : items
      return filtered.map(item => ({ ...item, type: kind }))
    })
  )

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
    const priv = isEffectivelyPrivate(doc, false)
    const isDragging = dragItem?.type === doc.type && dragItem.id === doc.id
    return (
      <div key={`${doc.type}-${doc.id}`} className={`tree-item-shell ${active ? 'active' : ''}${isDragging ? ' is-dragging' : ''}`}>
        <button
          className={`sb-item sb-item-main tree-row tree-doc ${active ? 'active' : ''} ${priv ? 'sb-item-private' : ''}`}
          style={{ paddingLeft: `${0.625 + depth * 1.125}rem` }}
          draggable={!readOnly}
          onDragEnd={handleItemDragEnd}
          onDragStart={(event) => handleItemDragStart(event, doc)}
          onClick={() => openDocument(doc.type, doc.id, doc.folder_id)}
          type="button"
        >
          {docKindIcon(doc.type)}
          <span className="sb-item-label">{doc.name}</span>
          {priv && <span className="sb-private-badge"><LockIcon /></span>}
        </button>
        {!readOnly && (
          <div className="item-actions">
            <button
              className={`tree-privacy-btn ${priv ? 'is-private' : ''}`}
              aria-label={priv ? `Make ${doc.name} public` : `Make ${doc.name} private`}
              onClick={(e) => { e.stopPropagation(); togglePrivate(doc, false) }}
              title={priv ? 'Make public' : 'Make private'}
              type="button"
            >
              {priv ? <UnlockIcon /> : <LockIcon />}
            </button>
            <button
              className="tree-delete-btn"
              aria-label={`Delete ${doc.name}`}
              onClick={(e) => { e.stopPropagation(); openDeleteDialog({ ...doc }) }}
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
    const priv = isEffectivelyPrivate(folder, true)
    const isDragging = dragItem?.type === 'folder' && dragItem.id === folder.id
    const isDropTarget = dropTargetFolderId === folder.id
    return (
      <div key={folder.id}>
        <div className={`tree-item-shell${isDragging ? ' is-dragging' : ''}`}>
          <button
            className={`sb-item sb-item-main tree-row tree-folder ${expanded ? 'folder-open' : ''} ${priv ? 'sb-item-private' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
            style={{ paddingLeft: `${0.625 + depth * 1.125}rem` }}
            draggable={!readOnly}
            onDragEnd={handleItemDragEnd}
            onDragOver={(event) => handleFolderDragOver(event, folder.id)}
            onDragStart={(event) => handleItemDragStart(event, { ...folder, type: 'folder' })}
            onDrop={(event) => handleFolderDrop(event, folder.id)}
            onClick={() => toggleFolder(folder.id)}
            type="button"
          >
            <span className={`tree-chevron ${expanded ? 'open' : ''}`}><ChevronRightIcon /></span>
            {expanded ? <FolderOpenIcon /> : <FolderIcon />}
            <span className="sb-item-label">{folder.name}</span>
            {priv && <span className="sb-private-badge"><LockIcon /></span>}
          </button>
          {!readOnly && (
            <div className="item-actions">
              <button
                className={`tree-privacy-btn ${priv ? 'is-private' : ''}`}
                aria-label={priv ? `Make ${folder.name} public` : `Make ${folder.name} private`}
                onClick={(e) => { e.stopPropagation(); togglePrivate(folder, true) }}
                title={priv ? 'Make public' : 'Make private'}
                type="button"
              >
                {priv ? <UnlockIcon /> : <LockIcon />}
              </button>
              <button
                className="tree-delete-btn"
                aria-label={`Delete ${folder.name}`}
                onClick={(e) => { e.stopPropagation(); openDeleteDialog({ ...folder, type: 'folder' }) }}
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
              <div className="sb-empty tree-empty" style={{ paddingLeft: `${1.75 + (depth + 1) * 1.125}rem` }}>
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

  // Map a search hit's `kind` field to our doc-type kinds.
  // Backend returns 'board' for board hits and 'sheet' for the legacy
  // spreadsheet (no longer creatable, but old data may still index).
  // Future: backend will return 'gdoc' / 'gsheet' for indexed Drive content.
  const hitKindToDocType = (kind) => {
    if (kind === 'gdoc' || kind === 'gsheet') return kind
    return 'board'
  }

  const findDocFromHit = (hit) => {
    const type = hitKindToDocType(hit.kind)
    return (docsByKind[type] || []).find(item => item.id === hit.doc_id)
  }

  const databaseBrowseItems = visibleDocs.map(doc => ({
    key: `${doc.type}-${doc.id}`,
    type: doc.type,
    docId: doc.id,
    name: doc.name,
    snippet: null,
    source: docTypeLabel(doc.type),
    createdAt: doc.created_at,
    folderId: doc.folder_id || null,
    folderPath: buildFolderPath(doc.folder_id, folderById),
    tags: doc.tags || [],
  }))

  const databaseSearchHits = query.trim()
    ? (() => {
      // Deduplicate by doc_id — keep the highest-scoring hit per doc,
      // but collect all snippets/sources to show the best one
      const seen = new Map()
      for (const hit of results) {
        const doc = findDocFromHit(hit)
        if (!doc) continue
        const type = hitKindToDocType(hit.kind)
        if (!seen.has(hit.doc_id)) {
          seen.set(hit.doc_id, {
            key: hit.doc_id,
            type,
            docId: hit.doc_id,
            name: hit.doc_name,
            snippet: hit.snippet,
            source: hit.source,
            score: hit.score,
            createdAt: doc.created_at,
            folderId: doc.folder_id || null,
            folderPath: buildFolderPath(doc.folder_id, folderById),
            tags: doc.tags || [],
          })
        }
        // If this hit has a better snippet (higher score), use it
        else if (hit.score > seen.get(hit.doc_id).score) {
          const existing = seen.get(hit.doc_id)
          seen.set(hit.doc_id, { ...existing, snippet: hit.snippet, source: hit.source, score: hit.score })
        }
      }
      return [...seen.values()]
    })()
    : []

  const saveOwner = async () => {
    const name = ownerInput.trim()
    if (!name) return
    const updated = await fetchJsonPatch(`${API}/api/workspace`, { owner: name })
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

  const clearDragState = () => {
    dragItemRef.current = null
    setDragItem(null)
    setDropTargetFolderId(null)
  }

  const isFolderDescendant = (folderId, possibleAncestorId) => {
    if (!folderId || !possibleAncestorId) return false
    let cursor = folderId
    const visited = new Set()
    while (cursor && !visited.has(cursor)) {
      if (cursor === possibleAncestorId) return true
      visited.add(cursor)
      cursor = folderById[cursor]?.parent_id || null
    }
    return false
  }

  const canDropIntoFolder = (item, targetFolderId) => {
    if (!item) return false
    const normalizedTargetId = targetFolderId || null
    if (item.type === 'folder') {
      if (item.id === normalizedTargetId) return false
      if ((item.parent_id || null) === normalizedTargetId) return false
      return !isFolderDescendant(normalizedTargetId, item.id)
    }
    return (item.folder_id || null) !== normalizedTargetId
  }

  const handleItemDragStart = (event, item) => {
    if (readOnly) return
    const payload = item.type === 'folder'
      ? { type: 'folder', id: item.id, name: item.name, parent_id: item.parent_id || null }
      : { type: item.type, id: item.id, name: item.name, folder_id: item.folder_id || null }
    dragItemRef.current = payload
    setDragItem(payload)
    setDropTargetFolderId(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${payload.type}:${payload.id}`)
  }

  const handleItemDragEnd = () => {
    clearDragState()
  }

  const handleFolderDragOver = (event, folderId) => {
    const dragged = dragItemRef.current
    if (!canDropIntoFolder(dragged, folderId)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (dropTargetFolderId !== folderId) setDropTargetFolderId(folderId)
  }

  const moveDraggedItem = async (targetFolderId) => {
    const dragged = dragItemRef.current
    if (!canDropIntoFolder(dragged, targetFolderId)) {
      clearDragState()
      return
    }

    const url = dragged.type === 'folder'
      ? `${API}/api/folders/${dragged.id}`
      : `${API}/api/${DOC_KIND_API[dragged.type]}/${dragged.id}`
    const body = dragged.type === 'folder'
      ? { parent_id: targetFolderId || null }
      : { folder_id: targetFolderId || null }

    const updated = await fetchJsonPatch(url, body)

    if (!updated) {
      showError(`Could not move ${dragged.name}.`)
      clearDragState()
      return
    }

    if (dragged.type === 'folder') {
      setFolders(current => current.map(folder => folder.id === updated.id ? updated : folder))
    } else {
      setDocsForKind(dragged.type, items => items.map(i => i.id === updated.id ? updated : i))
    }

    if (targetFolderId) expandFolderPath(targetFolderId)
    clearDragState()
  }

  const handleFolderDrop = async (event, folderId) => {
    const dragged = dragItemRef.current
    if (!canDropIntoFolder(dragged, folderId)) return
    event.preventDefault()
    event.stopPropagation()
    await moveDraggedItem(folderId)
  }

  const handleWorkspaceDragOver = (event) => {
    const dragged = dragItemRef.current
    if (!canDropIntoFolder(dragged, null)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTargetFolderId !== ROOT_FOLDER) setDropTargetFolderId(ROOT_FOLDER)
  }

  const handleWorkspaceDrop = async (event) => {
    const dragged = dragItemRef.current
    if (!canDropIntoFolder(dragged, null)) return
    event.preventDefault()
    await moveDraggedItem(null)
  }

  const handleWorkspaceDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetFolderId(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget || readOnly) return
    try {
      let endpoint
      if (deleteTarget.type === 'folder') {
        endpoint = `/api/folders/${deleteTarget.id}?mode=${deleteMode}`
      } else {
        const isDriveKind = deleteTarget.type === 'gdoc' || deleteTarget.type === 'gsheet'
        const driveQuery = isDriveKind && deleteAlsoDrive ? '?drive=1' : ''
        endpoint = `/api/${DOC_KIND_API[deleteTarget.type]}/${deleteTarget.id}${driveQuery}`
      }
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
      } else {
        setDocsForKind(deleteTarget.type, items => items.filter(i => i.id !== deleteTarget.id))
        if (activeId?.id === deleteTarget.id) goToDatabaseHome()
      }
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
      setDeleteMode('move')
      setDeleteAlsoDrive(false)
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
      let res
      try {
        res = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
      } catch {
        setAuthError('Backend offline. Make sure dev.command is running.')
        return
      }
      if (res.status >= 500) {
        setAuthError('Backend offline. Make sure dev.command is running.')
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if ((res.status === 409 && data.requires_setup) || data.setup_allowed === false || data.configured === false) {
          setAuthError(data.setup_allowed === false
            ? 'Station 8 access is not configured on the server. The owner needs to set OWNER_PASSWORD and VISITOR_PASSWORD on the backend.'
            : (data.error || 'Access passwords have not been set up yet'))
          return
        }
        setAuthError(data.error || 'Login failed')
        return
      }
      setLoginPassword('')
      await updateAuthStatus()
    } finally {
      setAuthBusy(false)
    }
  }, [loginPassword, route.doc, route.shareToken, updateAuthStatus])

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
        authConfigured={auth.configured}
        setupAllowed={auth.setupAllowed}
        backendOffline={auth.backendOffline}
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
      {/* Shared SVG <defs> for theme paint-servers — one copy, referenced by
          CSS `stroke: url(#…)` overrides per theme. Kept off-screen. */}
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      >
        <defs>
          <linearGradient id="s8-prism-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--s8-logo-prism-1)" />
            <stop offset="50%" stopColor="var(--s8-logo-prism-2)" />
            <stop offset="100%" stopColor="var(--s8-logo-prism-3)" />
          </linearGradient>
        </defs>
      </svg>
      {showSidebar && (
        <aside className="sidebar" id="workspace-sidebar" aria-hidden={sidebarCollapsed}>
          <div className="sidebar-head">
            <span className="sidebar-brand">Station 8</span>
          </div>

          {/* Content actions — three doc kinds on equal footing.
              Folder is a structural action and lives in the WORKSPACE
              section header below, not here. */}
          <div className="sidebar-actions sidebar-actions-3up">
            <button className="sidebar-action" onClick={openNewBoardModal} type="button">
              <BoardIcon /> Board
            </button>
            <button className="sidebar-action" onClick={openNewGDocModal} type="button">
              <DocIcon /> Doc
            </button>
            <button className="sidebar-action" onClick={openNewGSheetModal} type="button">
              <SheetIcon /> Sheet
            </button>
          </div>

          <div className="sb-section-row">
            <div className="sb-section">Workspace</div>
            <button
              className="sb-add"
              onClick={openNewFolderModal}
              title="New folder"
              aria-label="New folder"
              type="button"
            >
              <PlusIcon />
            </button>
          </div>
          <div
            className={`workspace-tree${dropTargetFolderId === ROOT_FOLDER ? ' is-root-drop-target' : ''}`}
            onDragLeave={handleWorkspaceDragLeave}
            onDragOver={handleWorkspaceDragOver}
            onDrop={handleWorkspaceDrop}
          >
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
                  const active = tagFilter === t
                  return (
                    <button key={t} className={`sb-tag${active ? ' active' : ''}`}
                      onClick={() => filterByTag(t)} type="button">
                      #{t} · {count}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="sb-section-row"><div className="sb-section">Search</div></div>
          <button className="search-btn" onClick={() => {
            if (activeId?.type === 'board') {
              const board = boards.find(b => b.id === activeId.id)
              setSearchScope(board ? { boardId: board.id, boardName: board.name } : null)
            } else {
              setSearchScope(null)
            }
            setFindQuery(null)
            setSearchOpen(true)
          }} type="button">
            <span className="search-btn-label"><SearchIcon /> Search</span>
            <span className="kbd">⌘K</span>
          </button>

          {/* Sticky footer */}
          <div className="sidebar-footer">
            <div className="sidebar-drive-card" data-connected={googleAuth.connected ? 'true' : 'false'}>
              <div className="sidebar-drive-head">
                <span className="sidebar-drive-label">
                  <span className="sidebar-drive-dot" />
                  Drive
                </span>
                {googleAuth.connected && (
                  <div className="sidebar-drive-actions">
                    {(gdocs.length > 0 || gsheets.length > 0) && (
                      <button
                        className={`sidebar-drive-icon${driveShareState.busy ? ' is-busy' : ''}`}
                        onClick={shareAllDrive}
                        title="Set every linked Doc and Sheet to 'anyone with link → reader' so visitors can view them"
                        type="button"
                        disabled={driveShareState.busy}
                      >
                        <GlobeIcon />
                      </button>
                    )}
                    <button
                      className={`sidebar-drive-icon${driveSettingsOpen ? ' is-active' : ''}`}
                      onClick={() => setDriveSettingsOpen(o => !o)}
                      title="Save location & folder mirroring"
                      type="button"
                    >
                      <PinIcon />
                    </button>
                    <button
                      className="sidebar-drive-icon"
                      onClick={disconnectGoogle}
                      title="Disconnect"
                      type="button"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                )}
              </div>
              {googleAuth.connected && driveSettingsOpen && (
                <div className="drive-settings-popover">
                  <div className="drive-settings-row">
                    <div className="drive-settings-label">Save new files to</div>
                    <button
                      className="drive-settings-folder-btn"
                      onClick={openDrivePicker}
                      type="button"
                      title="Choose a Drive folder for new files"
                    >
                      <FolderOpenIcon />
                      <span className="drive-settings-folder-name">{driveConfig.root_folder_name}</span>
                      <span className="drive-settings-folder-edit">Change</span>
                    </button>
                  </div>
                  <label className="drive-settings-toggle">
                    <input
                      type="checkbox"
                      checked={driveConfig.mirror_folders}
                      onChange={toggleDriveMirror}
                    />
                    <span className="drive-settings-toggle-text">
                      <span className="drive-settings-toggle-title">Mirror Station 8 folders in Drive</span>
                      <span className="drive-settings-toggle-sub">
                        New files land inside a Drive folder that matches their Station 8 folder path. Existing files aren't moved.
                      </span>
                    </span>
                  </label>
                </div>
              )}
              {googleAuth.connected ? (
                <div className="sidebar-drive-body">
                  {driveShareState.busy
                    ? 'Sharing…'
                    : (driveShareState.message || googleAuth.email)}
                </div>
              ) : (
                <button
                  className="sidebar-drive-link-btn"
                  onClick={openGoogleConnect}
                  title="Link your account to create Docs and Sheets"
                  type="button"
                  disabled={googleAuth.loading}
                >
                  <PlusIcon /> <span>Link account</span>
                </button>
              )}
            </div>
            <div className="sidebar-utility-row">
              <button
                className="sidebar-utility-btn"
                onClick={() => setColorMode(m => m === 'dark' ? 'light' : 'dark')}
                title={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                type="button"
              >
                <ThemeToggleIcon />
                <span>{colorMode === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
              <button
                className="sidebar-utility-btn sidebar-utility-danger"
                onClick={handleLogout}
                title="Log out"
                type="button"
              >
                <LogoutIcon />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile/tablet sidebar drawer scrim. CSS-hidden on desktop; visible
          only when the sidebar is open AND the viewport is below the tablet-
          landscape breakpoint. Tap dismisses the drawer. */}
      {showSidebar && !sidebarCollapsed && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Close sidebar"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      <main key={scanSurfaceKey} className={mainClassName}>
        {showDatabaseHome ? (
          <DatabaseHome
            query={query}
            onQueryChange={setQuery}
            items={databaseBrowseItems}
            searchHits={databaseSearchHits}
            folders={folders}
            allTags={allTags}
            topTags={allTags.slice(0, 3).map(([t]) => t)}
            tagColor={tagColor}
            onOpenItem={(type, docId) => {
              openDocument(type, docId)
              // If opening a board from a search result, trigger FindBar
              if (type === 'board' && query.trim()) {
                setFindQuery(query)
                // Collect all unique board IDs from results in order
                const boardIds = [...new Set(
                  results
                    .filter(r => r.doc_type === 'board')
                    .map(r => r.doc_id)
                )]
                setFindBoards(boardIds)
              }
            }}
            onLogout={handleLogout}
            searchRef={homeSearchRef}
            backendStatus={backendStatus}
            searchLoading={searchLoading}
            colorMode={colorMode}
            onToggleColorMode={() => setColorMode(m => m === 'dark' ? 'light' : 'dark')}
          />
        ) : (
          <>
            {/* Floating pill — owner view, board open */}
            {ownerMode && activeDoc && (
              <div className="pill-wrap">
                <div className="pill">
                  <button
                    className="pill-icon-btn"
                    onClick={() => setSidebarCollapsed(c => !c)}
                    aria-label="Toggle sidebar"
                    type="button"
                  >
                    <SidebarExpandIcon />
                  </button>
                  <div className="pill-sep" />
                  <button
                    className="pill-title-btn"
                    onClick={() => setTitleMenuOpen(o => !o)}
                    type="button"
                  >
                    <span className="pill-title-text">{activeDoc.name}</span>
                    <span className="pill-chevron">▾</span>
                  </button>
                  {saveState === 'saving' && <span className="pill-saving" />}
                  {saveState === 'error' && <span className="pill-error">!</span>}
                </div>

                {titleMenuOpen && (
                  <div className="title-menu">
                    {/* Tags */}
                    <div className="title-menu-tags-section">
                      <div className="title-menu-tags-label">Tags</div>
                      <div className="title-menu-tags">
                        {(activeDoc?.tags || []).map(t => {
                          const c = tagColor(t)
                          return (
                            <span key={t} className="tag-pill" style={{ background: c.bg, color: c.fg }}>
                              #{t}
                              <button className="tag-pill-remove" onClick={() => removeTagFromActive(t)} type="button">×</button>
                            </span>
                          )
                        })}
                        {tagInputOpen ? (
                          <input
                            className="tag-input"
                            autoFocus
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { addTagToActive(); setTagInputOpen(false) }
                              if (e.key === 'Escape') setTagInputOpen(false)
                            }}
                            onBlur={() => { addTagToActive(); setTagInputOpen(false) }}
                            placeholder="tag name"
                          />
                        ) : (
                          <button className="tag-add" onClick={() => setTagInputOpen(true)} type="button">+ tag</button>
                        )}
                      </div>
                    </div>
                    <div className="title-menu-sep" />
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
                      Copy {docTypeLabel(activeDocType).toLowerCase()} link
                    </button>
                    {activeDoc && activeDocType && (
                      <>
                        <div className="title-menu-sep" />
                        <button
                          className="title-menu-item title-menu-danger"
                          onClick={() => { openDeleteDialog({ ...activeDoc, type: activeDocType }); setTitleMenuOpen(false) }}
                          type="button"
                        >
                          Delete {docTypeLabel(activeDocType).toLowerCase()}…
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

            {/* Visitor / share pill — branding + read-only badge + back button.
                Search button is here because visitors don't see the sidebar
                (where the owner's search lives), so without this they'd have
                no discoverable way to trigger search beyond the ⌘K shortcut. */}
            {readOnly && activeDoc && (
              <div className="pill-wrap">
                <div className="pill">
                  <button
                    className="pill-icon-btn"
                    onClick={goToDatabaseHome}
                    title="Back to database"
                    type="button"
                  >←</button>
                  <div className="pill-sep" />
                  <span className="pill-brand">STATION 8</span>
                  <div className="pill-sep" />
                  <span className="pill-title-text pill-title-static">{activeDoc.name}</span>
                  <span className="pill-ro-badge">Read Only</span>
                  <div className="pill-sep" />
                  <button
                    className="pill-icon-btn pill-search-btn"
                    onClick={() => {
                      setSearchScope(null)
                      setFindQuery(null)
                      setSearchOpen(true)
                    }}
                    title="Search Station 8 (⌘K)"
                    aria-label="Search Station 8"
                    type="button"
                  ><SearchIcon /></button>
                </div>
              </div>
            )}

            <div className="work-area">
              {activeId?.type === 'board' && (
                <>
                  <TldrawCanvas
                    key={activeId.id}
                    boardId={activeId.id}
                    readOnly={readOnly}
                    viewerMode={viewerMode}
                    shareSlug={route.shareToken}
                    onSaveState={setSaveState}
                    colorMode={colorMode}
                    findQuery={findQuery}
                    onFindDismiss={onFindDismiss}
                    findBoards={findBoards}
                    findShapeIds={findShapeIdsByBoard[activeId.id] || []}
                    onNavigateBoard={(boardId) => {
                      const board = boards.find(b => b.id === boardId)
                      openDocument('board', boardId, board?.folder_id)
                    }}
                  />
                </>
              )}
              {(activeId?.type === 'gdoc' || activeId?.type === 'gsheet') && activeDoc && (
                <GoogleEmbed
                  key={activeId.id}
                  kind={activeId.type}
                  doc={activeDoc}
                  readOnly={readOnly}
                  googleConnected={googleAuth.connected}
                  onConnectGoogle={openGoogleConnect}
                />
              )}
              {!activeId && ownerMode && (
                <div className="empty-main">
                  <div>
                    <div className="big">Nothing open</div>
                    <div className="small">Create folders, boards, docs, and sheets to organize your research.</div>
                    <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="cta" onClick={openNewFolderModal} type="button">New folder</button>
                      <button className="cta" onClick={openNewBoardModal} type="button">New board</button>
                      <button className="cta" onClick={openNewGDocModal} type="button">New doc</button>
                      <button className="cta" onClick={openNewGSheetModal} type="button">New sheet</button>
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

      {newGDocOpen && (
        <Modal onClose={() => setNewGDocOpen(false)} title="New Google Doc">
          <input
            autoFocus
            value={newGDocName}
            onChange={e => setNewGDocName(e.target.value)}
            placeholder="Name this doc"
            onKeyDown={e => { if (e.key === 'Enter') createGdoc() }}
          />
          <FolderField label="Create in" value={newGDocFolderId} options={folderOptions} onChange={setNewGDocFolderId} />
          <GDriveUrlField
            value={newGDocUrl}
            onChange={setNewGDocUrl}
            googleConnected={googleAuth.connected}
            placeholder="https://docs.google.com/document/d/…"
            kindLabel="doc"
          />
          <ModalFooter onCancel={() => setNewGDocOpen(false)} onConfirm={createGdoc} disabled={!newGDocName.trim()} />
        </Modal>
      )}

      {newGSheetOpen && (
        <Modal onClose={() => setNewGSheetOpen(false)} title="New Google Sheet">
          <input
            autoFocus
            value={newGSheetName}
            onChange={e => setNewGSheetName(e.target.value)}
            placeholder="Name this sheet"
            onKeyDown={e => { if (e.key === 'Enter') createGsheet() }}
          />
          <FolderField label="Create in" value={newGSheetFolderId} options={folderOptions} onChange={setNewGSheetFolderId} />
          <GDriveUrlField
            value={newGSheetUrl}
            onChange={setNewGSheetUrl}
            googleConnected={googleAuth.connected}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            kindLabel="sheet"
          />
          <ModalFooter onCancel={() => setNewGSheetOpen(false)} onConfirm={createGsheet} disabled={!newGSheetName.trim()} />
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
            <div className="modal-copy">
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
              <label className="modal-field-label">Your display name:</label>
              <input
                className="share-owner-input"
                value={workspace.owner || ''}
                onChange={(e) => setWorkspace(w => ({ ...w, owner: e.target.value }))}
                onBlur={async (e) => {
                  const updated = await fetchJsonPatch(`${API}/api/workspace`, { owner: e.target.value })
                  if (updated) setWorkspace(updated)
                }}
              />
            </div>
          </div>
        </Modal>
      )}

      {ownerPromptOpen && (
        <Modal onClose={skipOwner} title="What's your name?">
          <p style={{ fontSize: '0.8125rem', color: 'var(--s8-text-mid)', marginBottom: '0.75rem' }}>
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
        <Modal
          onClose={() => { setDeleteConfirmOpen(false); setDeleteTarget(null); setDeleteAlsoDrive(false) }}
          title={`Delete ${deleteTarget.type === 'folder' ? 'folder' : (DOC_KIND_LABEL[deleteTarget.type] || 'item').toLowerCase()}`}
        >
          <div className="delete-dialog-body">
            <p className="modal-copy">
              {deleteTarget.type === 'folder'
                ? <>Choose what should happen to <strong>{deleteTarget.name}</strong>.</>
                : (deleteTarget.type === 'gdoc' || deleteTarget.type === 'gsheet')
                  ? <><strong>{deleteTarget.name}</strong> will be removed from Station 8. The file in your Google Drive stays put unless you opt in below.</>
                  : <><strong>{deleteTarget.name}</strong> will be permanently removed.</>}
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

            {deleteTarget.type === 'board' && (
              <p className="delete-dialog-note">
                Its canvas data will be removed, and uploaded images tied only to this board will be cleaned up too.
              </p>
            )}

            {(deleteTarget.type === 'gdoc' || deleteTarget.type === 'gsheet') && (
              <label className="delete-drive-toggle">
                <input
                  type="checkbox"
                  checked={deleteAlsoDrive}
                  onChange={(e) => setDeleteAlsoDrive(e.target.checked)}
                />
                <span className="delete-drive-toggle-text">
                  <span className="delete-drive-toggle-title">Also delete from Google Drive</span>
                  <span className="delete-drive-toggle-sub">Permanently removes the underlying file from your Drive. This cannot be undone.</span>
                </span>
              </label>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn-ghost" onClick={() => { setDeleteConfirmOpen(false); setDeleteTarget(null); setDeleteMode('move'); setDeleteAlsoDrive(false) }} type="button">Cancel</button>
            <button className="btn-primary btn-danger" onClick={handleDelete} type="button">
              {deleteTarget.type === 'folder' && deleteMode === 'move' ? 'Delete folder' : 'Delete permanently'}
            </button>
          </div>
        </Modal>
      )}

      {drivePickerOpen && (
        <Modal
          onClose={() => setDrivePickerOpen(false)}
          title="Choose a Drive folder"
        >
          <div className="drive-picker-body">
            <div className="drive-picker-breadcrumb">
              {drivePicker.breadcrumb.map((crumb, idx) => (
                <span key={`${crumb.id || 'root'}-${idx}`} className="drive-picker-crumb-wrap">
                  <button
                    className="drive-picker-crumb"
                    onClick={() => drivePickerJumpTo(idx)}
                    disabled={idx === drivePicker.breadcrumb.length - 1 || drivePicker.loading}
                    type="button"
                  >{crumb.name}</button>
                  {idx < drivePicker.breadcrumb.length - 1 && <span className="drive-picker-crumb-sep">›</span>}
                </span>
              ))}
            </div>
            <div className="drive-picker-list">
              {drivePicker.loading && <div className="drive-picker-empty">Loading…</div>}
              {!drivePicker.loading && drivePicker.error && <div className="drive-picker-empty">{drivePicker.error}</div>}
              {!drivePicker.loading && !drivePicker.error && drivePicker.folders.length === 0 && (
                <div className="drive-picker-empty">No subfolders here.</div>
              )}
              {!drivePicker.loading && !drivePicker.error && drivePicker.folders.map((f) => (
                <button
                  key={f.id}
                  className="drive-picker-row"
                  onClick={() => drivePickerEnter(f)}
                  type="button"
                >
                  <FolderIcon />
                  <span className="drive-picker-row-name">{f.name}</span>
                  <ChevronRightIcon />
                </button>
              ))}
            </div>
            <p className="drive-picker-hint">
              New Docs and Sheets will be saved to <strong>{drivePicker.breadcrumb[drivePicker.breadcrumb.length - 1]?.name || 'My Drive'}</strong>.
            </p>
          </div>
          <div className="modal-footer">
            <button className="btn-ghost" onClick={() => setDrivePickerOpen(false)} type="button">Cancel</button>
            <button
              className="btn-primary"
              onClick={() => {
                const target = drivePicker.breadcrumb[drivePicker.breadcrumb.length - 1]
                saveDriveRootFolder(target?.id || null)
              }}
              type="button"
              disabled={drivePicker.loading}
            >
              Save this folder
            </button>
          </div>
        </Modal>
      )}

      {searchOpen && (
        <Modal onClose={() => { setSearchOpen(false); setSearchScope(null) }} wide>
          {searchScope && (
            <div className="search-scope-row">
              <div className="search-scope-pill">
                <span className="search-scope-pill-name">{searchScope.boardName}</span>
                <button
                  className="search-scope-pill-clear"
                  aria-label="Remove scope"
                  onClick={() => setSearchScope(null)}
                  type="button"
                >✕</button>
              </div>
            </div>
          )}
          <div className="search-input-wrap">
            <SearchIcon className="search-input-icon" />
            <input
              autoFocus
              className="search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchScope ? 'Search in this board…' : 'Search across everything…'}
            />
          </div>
          {searchScope && (
            <button
              className="search-all-link"
              onClick={() => setSearchScope(null)}
              type="button"
            >Search all boards</button>
          )}
          {!query && <div className="hint">Text, shapes, sticky notes, sheet cells, OCR — across all boards and sheets.</div>}
          <div className="results">
              {searchLoading ? (
                <div className="result-empty">Searching…</div>
              ) : results.map((r, i) => (
                <div
                  key={i}
                  className="result"
                  onClick={() => {
                    const hitType = hitKindToDocType(r.kind)
                    const hitDoc = (docsByKind[hitType] || []).find(item => item.id === r.doc_id)
                    openDocument(hitType, r.doc_id, hitDoc?.folder_id)
                    if (hitType === 'board') {
                      setFindQuery(query)
                      const boardIds = [...new Set(
                        results.filter(r2 => r2.doc_type === 'board').map(r2 => r2.doc_id)
                      )]
                      setFindBoards(boardIds)
                    }
                    setSearchOpen(false)
                  }}
                >
                  <span className={`result-kind-pill kind-${r.kind}`}>{KIND_PILL_LABEL[r.kind] || r.kind.toUpperCase()}</span>
                  <div className="result-body">
                    <div className="result-quote">{renderHighlightedSnippet(r.snippet, query)}</div>
                    <div className="result-breadcrumb">
                      <span className="crumb">{r.doc_name}</span>
                      <span className="crumb-sep">→</span>
                      <span className="crumb crumb-tail">{r.source}</span>
                    </div>
                  </div>
                </div>
              ))}
              {query && !searchLoading && results.length === 0 && <div className="result-empty">No hits</div>}
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
  authConfigured = true,
  setupAllowed = false,
  requiresSetup = false,
  backendOffline = false,
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
      <div className="auth-shell s8-grid">
        <div className="auth-card auth-card-loading">
          <div className="auth-kicker">Station 8</div>
          <div className="auth-title">Loading access state…</div>
        </div>
      </div>
    )
  }

  if (backendOffline) {
    return (
      <div className="auth-shell s8-grid">
        <div className="auth-card">
          <div className="auth-kicker">Station 8</div>
          <h1 className="auth-title">Backend offline</h1>
          <p className="auth-copy">
            The Station 8 backend isn't responding at <code>localhost:5001</code>.
            Make sure <code>dev.command</code> is running, then reload this page.
          </p>
          <p className="auth-copy" style={{ marginTop: '0.625rem', fontSize: '0.75rem', opacity: 0.7 }}>
            If it keeps failing, open <code>data/server.log</code> to see what crashed.
          </p>
          <button
            className="auth-submit"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }

  const directLabel = route?.doc ? `${docTypeLabel(route.doc.type)} link` : 'Workspace'
  const allowSetup = requiresSetup && setupAllowed
  const configMissing = !authConfigured && !setupAllowed

  return (
    <div className="auth-shell s8-grid">
      <div className="auth-card">
        <div className="auth-kicker">Station 8</div>
        <h1 className="auth-title">{allowSetup ? 'Set up access' : configMissing ? 'Access offline' : 'Enter the workspace'}</h1>
        <p className="auth-copy">
          {allowSetup
            ? 'Create the owner and visitor passwords. After setup, the same password field routes people into owner or visitor mode automatically.'
            : configMissing
            ? 'Station 8 access is not configured on the server. The owner needs to set OWNER_PASSWORD and VISITOR_PASSWORD on the backend.'
            : `${directLabel} is protected. Enter either the owner password or the visitor password to continue.`}
        </p>

        {allowSetup ? (
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
        ) : !configMissing ? (
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
        ) : null}

        {authError && <div className="auth-error">{authError}</div>}
      </div>
    </div>
  )
}

function DatabaseHome({
  query,
  onQueryChange,
  items,
  searchHits,
  folders,
  allTags,
  topTags,
  tagColor,
  onOpenItem,
  onLogout,
  searchRef,
  backendStatus,
  searchLoading,
  colorMode,
  onToggleColorMode,
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [folderPath, setFolderPath] = useState([])
  const [selectedTags, setSelectedTags] = useState(() => new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const [resultsExpanded, setResultsExpanded] = useState(false)
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 599px)').matches
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 599px)')
    const handler = (e) => setIsPhone(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const resultsThreshold = isPhone ? 3 : 6
  const isReady = backendStatus === 'ready'
  const hasQuery = !!query.trim()

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    setResultsExpanded(false)
  }, [folderPath, selectedTags, query])

  useEffect(() => {
    if (isReady) return
    const t = setInterval(() => setElapsedSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [isReady])

  const statusMessage = isReady
    ? null
    : elapsedSeconds < 15
    ? 'Waking up…'
    : elapsedSeconds < 35
    ? 'Almost there…'
    : 'Taking a little longer than usual…'

  const folderById = useMemo(() => {
    const m = {}
    for (const f of (folders || [])) m[f.id] = f
    return m
  }, [folders])

  // Map parent_id → sorted child folders
  const childFoldersOf = useMemo(() => {
    const m = new Map()
    for (const f of (folders || [])) {
      const pid = f.parent_id || null
      if (!m.has(pid)) m.set(pid, [])
      m.get(pid).push(f)
    }
    for (const [, arr] of m) arr.sort((a, b) => a.name.localeCompare(b.name))
    return m
  }, [folders])

  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1] : null
  const isDrilledIn = folderPath.length > 0

  // BFS to collect all descendant folder IDs (including self)
  const descendantFolderIds = useCallback((folderId) => {
    const result = new Set([folderId])
    const queue = [folderId]
    while (queue.length > 0) {
      const cur = queue.shift()
      for (const c of (childFoldersOf.get(cur) || [])) {
        if (!result.has(c.id)) { result.add(c.id); queue.push(c.id) }
      }
    }
    return result
  }, [childFoldersOf])

  // Folder rail: always shows top-level folders. Clicking one drills in.
  const folderRail = useMemo(() => {
    const topLevel = (childFoldersOf.get(null) || []).map(f => {
      const descIds = descendantFolderIds(f.id)
      const count = items.filter(item => descIds.has(item.folderId)).length
      return { id: f.id, name: f.name, count }
    }).filter(f => f.count > 0)
    topLevel.sort((a, b) => a.name.localeCompare(b.name))
    return topLevel
  }, [items, childFoldersOf, descendantFolderIds])

  // Tag-filtered items scoped to current folder (all descendants)
  const filteredItems = useMemo(() => {
    const descIds = currentFolderId ? descendantFolderIds(currentFolderId) : null
    return items.filter(item => {
      if (descIds && !descIds.has(item.folderId)) return false
      if (selectedTags.size === 0) return true
      const itemTags = item.tags || []
      for (const t of selectedTags) if (!itemTags.includes(t)) return false
      return true
    })
  }, [items, currentFolderId, selectedTags, descendantFolderIds])

  const recentItems = useMemo(() => {
    if (hasQuery) return []
    const sorted = [...items].sort((a, b) => {
      const av = a.createdAt || ''
      const bv = b.createdAt || ''
      return av < bv ? 1 : av > bv ? -1 : 0
    })
    return sorted.slice(0, 4)
  }, [items, hasQuery])

  const toggleTag = (tag) => {
    setSelectedTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  // Direct docs: items whose folderId matches the current folder exactly
  const directDocs = useMemo(() => {
    if (!isDrilledIn) return []
    return items.filter(item => {
      if (item.folderId !== currentFolderId) return false
      if (selectedTags.size === 0) return true
      const itemTags = item.tags || []
      for (const t of selectedTags) if (!itemTags.includes(t)) return false
      return true
    })
  }, [items, isDrilledIn, currentFolderId, selectedTags])

  // Child subfolders with doc counts (for rendering as folder cards in drilldown)
  const childFolders = useMemo(() => {
    if (!isDrilledIn) return []
    return (childFoldersOf.get(currentFolderId) || []).map(f => {
      const descIds = descendantFolderIds(f.id)
      const count = items.filter(item => {
        if (!descIds.has(item.folderId)) return false
        if (selectedTags.size === 0) return true
        const itemTags = item.tags || []
        for (const t of selectedTags) if (!itemTags.includes(t)) return false
        return true
      }).length
      return { ...f, count }
    }).filter(f => f.count > 0)
  }, [items, isDrilledIn, currentFolderId, childFoldersOf, descendantFolderIds, selectedTags])

  // Breadcrumb segments
  const breadcrumbSegments = useMemo(() => {
    const segs = [{ id: null, name: 'All' }]
    for (const fid of folderPath) {
      const f = folderById[fid]
      if (f) segs.push({ id: fid, name: f.name })
    }
    return segs
  }, [folderPath, folderById])

  // Divider label
  const dividerLabel = (() => {
    if (isDrilledIn) {
      const f = folderById[currentFolderId]
      const title = (f ? f.name : 'ALL').toUpperCase()
      let tagSuffix = ''
      if (selectedTags.size > 0) {
        tagSuffix = ' / ' + [...selectedTags].map(t => '#' + t.toUpperCase()).join(' + ')
      }
      const total = filteredItems.length
      const unit = total === 1 ? 'DOCUMENT' : 'DOCUMENTS'
      return `${title}${tagSuffix} · ${total} ${unit}`
    }
    let tagSuffix = ''
    if (selectedTags.size > 0) {
      tagSuffix = ' / ' + [...selectedTags].map(t => '#' + t.toUpperCase()).join(' + ')
    }
    const total = filteredItems.length
    const unit = total === 1 ? 'DOCUMENT' : 'DOCUMENTS'
    return `ALL${tagSuffix} · ${total} ${unit}`
  })()

  return (
    <div className="database-home s8-grid">
     <div className="database-page">
      <div className="database-topbar">
        <div className="database-brand-wrap">
          <span className="database-brand"><span className="database-brand-dot" />STATION 8</span>
          <span className="database-brand-status">VISITOR ACCESS</span>
        </div>
        <label className={`database-search ${!isReady ? 'database-search--loading' : ''}`}>
          <SearchIcon />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => isReady && onQueryChange(e.target.value)}
            placeholder={isReady ? 'Search the archive…' : 'Search will be ready shortly…'}
            disabled={!isReady}
          />
          {!isReady && (
            <span className="database-search-status">
              <span className="database-search-dot" />
              {statusMessage}
            </span>
          )}
          {isReady && <span className="database-search-hint">⌘K</span>}
        </label>
        {onToggleColorMode && (
          <button
            className="database-theme-btn"
            onClick={onToggleColorMode}
            title={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={colorMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            type="button"
          >
            <ThemeToggleIcon />
          </button>
        )}
        <button className="database-logout" onClick={onLogout} type="button">Logout</button>
        <div className="database-overflow" ref={menuRef}>
          <button
            className="database-overflow-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="More actions"
            aria-expanded={menuOpen}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="3" cy="8" r="1.4" fill="currentColor" />
              <circle cx="8" cy="8" r="1.4" fill="currentColor" />
              <circle cx="13" cy="8" r="1.4" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div className="database-overflow-menu" role="menu">
              {onToggleColorMode && (
                <button
                  type="button"
                  role="menuitem"
                  className="database-overflow-item"
                  onClick={() => { onToggleColorMode(); setMenuOpen(false) }}
                >
                  <ThemeToggleIcon />
                  <span>{colorMode === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="database-overflow-item database-overflow-item--danger"
                onClick={() => { setMenuOpen(false); onLogout() }}
              >
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {hasQuery && (
        <div className="database-search-results">
          <div className="database-search-results-header">
            <span className="database-search-results-title">
              {searchLoading
                ? 'SEARCHING…'
                : `${(searchHits || []).length} ${(searchHits || []).length === 1 ? 'RESULT' : 'RESULTS'} FOR "${query.toUpperCase()}"`}
            </span>
            <button
              type="button"
              className="database-search-results-clear"
              onClick={() => onQueryChange('')}
            >Clear search</button>
          </div>
          {!searchLoading && (searchHits || []).length > 0 && (
            <div className="database-search-result-list">
              {(searchHits || []).slice(0, 6).map(item => (
                <button
                  key={`sr-${item.key}`}
                  type="button"
                  className="database-search-result"
                  onClick={() => onOpenItem(item.type, item.docId)}
                >
                  <span className="database-sr-type">{docTypeLabel(item.type)}</span>
                  <span className="database-sr-content">
                    <span className="database-sr-title">{item.name}</span>
                    {item.snippet && <span className="database-sr-snippet">{item.snippet}</span>}
                  </span>
                  <span className="database-sr-meta">{item.folderPath || 'Workspace root'}</span>
                </button>
              ))}
            </div>
          )}
          {!searchLoading && (searchHits || []).length === 0 && (
            <div className="database-search-results-empty">Nothing public matched that search.</div>
          )}
        </div>
      )}

      <div className="database-hero">
          <h1 className="database-hero-title">Research Database</h1>
          <p className="database-hero-sub">Boards, docs, and field notes from across Station 8. Every image, sticky, and cell is indexed.</p>
          {topTags && topTags.length > 0 && (
            <div className="database-hero-tries">
              <span className="database-hero-tries-label">Try</span>
              {topTags.map((t) => (
                <button
                  key={t}
                  className="database-hero-try"
                  type="button"
                  onClick={() => {
                    if (!isReady) return
                    onQueryChange(t)
                    if (searchRef && searchRef.current) searchRef.current.focus()
                  }}
                  disabled={!isReady}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

      {(folderRail.length > 0 || (allTags || []).length > 0) && (
        <div className="database-explore">
          {folderRail.length > 0 && (
            <div className="database-explore-col">
              <div className="database-explore-label">Browse by Folder</div>
              <div className="database-folder-chips">
                <button
                  type="button"
                  className={`database-folder-chip${!isDrilledIn ? ' is-active' : ''}`}
                  onClick={() => setFolderPath([])}
                >
                  All <span className="database-chip-count">{items.length}</span>
                </button>
                {folderRail.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    className={`database-folder-chip${currentFolderId === f.id ? ' is-active' : ''}`}
                    onClick={() => setFolderPath([f.id])}
                  >
                    {f.name} <span className="database-chip-count">{f.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {(allTags || []).length > 0 && (
            <div className="database-explore-col">
              <div className="database-explore-label">Browse by Tag</div>
              <div className="database-tag-chips">
                {allTags.map(([t]) => (
                  <button
                    key={t}
                    type="button"
                    className={`database-tag-chip${selectedTags.has(t) ? ' is-active' : ''}`}
                    onClick={() => toggleTag(t)}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isDrilledIn && (
        <nav className="database-breadcrumb">
          {breadcrumbSegments.map((seg, i) => {
            const isLast = i === breadcrumbSegments.length - 1
            return (
              <Fragment key={seg.id ?? 'all'}>
                {i > 0 && <span className="database-breadcrumb-sep">›</span>}
                {isLast ? (
                  <span className="database-breadcrumb-segment is-current">{seg.name}</span>
                ) : (
                  <button
                    type="button"
                    className="database-breadcrumb-segment"
                    onClick={() => seg.id === null
                      ? setFolderPath([])
                      : setFolderPath(folderPath.slice(0, i))
                    }
                  >{seg.name}</button>
                )}
              </Fragment>
            )
          })}
        </nav>
      )}

      <div className="database-divider">
        <span className="database-divider-label">{dividerLabel}</span>
        <span className="database-divider-line" />
      </div>

      {isDrilledIn ? (
        /* ── Drilldown view: Finder pattern — subfolder cards first, then files ── */
        <>
          {childFolders.length > 0 && (
            <div className="database-results is-expanded">
              {childFolders.map(sf => (
                <button
                  key={sf.id}
                  type="button"
                  className="database-card"
                  data-card-type="folder"
                  onClick={() => setFolderPath(prev => [...prev, sf.id])}
                >
                  <div className="database-card-top">
                    <span className="database-card-type database-card-type--folder"><FolderIcon /><span>Folder</span></span>
                    <span className="database-card-date">{sf.count} {sf.count === 1 ? 'item' : 'items'}</span>
                  </div>
                  <div className="database-card-title">{sf.name}</div>
                </button>
              ))}
            </div>
          )}
          {directDocs.length > 0 && (
            <div className="database-results is-expanded">
              {directDocs.map((item) => (
                <button
                  key={item.key}
                  className="database-card"
                  onClick={() => onOpenItem(item.type, item.docId)}
                  type="button"
                >
                  <div className="database-card-top">
                    <span className="database-card-type">{docTypeLabel(item.type)}</span>
                    <span className="database-card-date">{formatDocDate(item.createdAt)}</span>
                  </div>
                  <div className="database-card-title">{item.name}</div>
                  {item.snippet && <div className="database-card-snippet">{item.snippet}</div>}
                  <div className="database-card-meta">
                    {item.tags.slice(0, 4).map((tag) => {
                      const c = tagColor(tag)
                      return (
                        <span key={tag} className="tag-pill" style={{ background: c.bg, color: c.fg }}>
                          #{tag}
                        </span>
                      )
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}
          {directDocs.length === 0 && childFolders.length === 0 && (
            <div className="database-empty">
              {selectedTags.size > 0 ? (
                <>
                  <div className="database-empty-title">No documents match this filter.</div>
                  <div className="database-empty-copy">
                    <button
                      type="button"
                      className="database-empty-reset"
                      onClick={() => { setFolderPath([]); setSelectedTags(new Set()) }}
                    >Clear filters</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="database-empty-title">This folder is empty.</div>
                  <div className="database-empty-copy">
                    <button
                      type="button"
                      className="database-empty-reset"
                      onClick={() => setFolderPath([])}
                    >Back to all</button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        /* ── Top-level view: flat card grid ── */
        <>
          <div className={`database-results${resultsExpanded ? ' is-expanded' : ''}`}>
            {filteredItems.map((item) => (
              <button
                key={item.key}
                className="database-card"
                onClick={() => onOpenItem(item.type, item.docId)}
                type="button"
              >
                <div className="database-card-top">
                  <span className="database-card-type">{docTypeLabel(item.type)}</span>
                  <span className="database-card-date">{formatDocDate(item.createdAt)}</span>
                </div>
                <div className="database-card-title">{item.name}</div>
                {item.snippet && <div className="database-card-snippet">{item.snippet}</div>}
                <div className="database-card-meta">
                  <span className="database-card-folder">{item.folderPath || 'Workspace root'}</span>
                  {item.tags.slice(0, 4).map((tag) => {
                    const c = tagColor(tag)
                    return (
                      <span key={tag} className="tag-pill" style={{ background: c.bg, color: c.fg }}>
                        #{tag}
                      </span>
                    )
                  })}
                </div>
              </button>
            ))}
            {filteredItems.length > resultsThreshold && (
              <button
                type="button"
                className="database-results-expand"
                onClick={() => setResultsExpanded(e => !e)}
                aria-expanded={resultsExpanded}
              >
                <span className="database-results-expand-label">
                  {resultsExpanded ? 'Collapse' : `${filteredItems.length - resultsThreshold} More`}
                </span>
              </button>
            )}
            {filteredItems.length === 0 && (
              <div className="database-empty">
                {searchLoading ? (
                  <>
                    <div className="database-empty-title">Searching…</div>
                    <div className="database-empty-copy">Hang tight.</div>
                  </>
                ) : hasQuery ? (
                  <>
                    <div className="database-empty-title">Nothing public matched that search.</div>
                    <div className="database-empty-copy">Clear the query or add more public material to the workspace.</div>
                  </>
                ) : selectedTags.size > 0 ? (
                  <>
                    <div className="database-empty-title">No documents match this filter.</div>
                    <div className="database-empty-copy">
                      <button
                        type="button"
                        className="database-empty-reset"
                        onClick={() => setSelectedTags(new Set())}
                      >Clear filters</button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}

      {recentItems.length > 0 && (
        <>
          <div className="database-divider">
            <span className="database-divider-label">Recently Updated</span>
            <span className="database-divider-line" />
          </div>
          <div className="database-feed">
            {recentItems.map(item => (
              <button
                key={`recent-${item.key}`}
                className="database-feed-card"
                data-doc-type={item.type}
                onClick={() => onOpenItem(item.type, item.docId)}
                type="button"
              >
                <div className="database-feed-title">{item.name}</div>
                <div className="database-feed-meta">{formatDocDate(item.createdAt)}</div>
              </button>
            ))}
          </div>
        </>
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

function GoogleEmbed({ kind, doc, readOnly, googleConnected, onConnectGoogle }) {
  // Embed URLs:
  //   - /edit?usp=…  → full editor UI inside the iframe (owner)
  //   - /preview     → clean read-only render (visitor)
  //
  // Google's /preview view still draws a thin top bar with doc name + "Open in
  // Google" link. We crop that off via CSS (`.is-readonly` on the wrapper) so
  // visitors see only the doc body — Station 8's pill already shows the title.
  //
  // We do NOT try to intercept keyboard shortcuts inside the iframe. Cross-
  // origin iframes own their own keyboard; ⌘F inside a Google Doc goes to
  // Google's in-doc find, and that's fine. Station 8 search is on ⌘K + the
  // visitor-pill search button — both work regardless of focus.
  const url = doc.embed_url
  if (!url) {
    const kindLabel = kind === 'gdoc' ? 'Google Doc' : 'Google Sheet'
    return (
      <div className="gdrive-empty">
        <div className="gdrive-empty-card">
          <div className="gdrive-empty-icon"><GoogleLogoIcon /></div>
          <div className="gdrive-empty-title">{kindLabel} not linked yet</div>
          <div className="gdrive-empty-copy">
            {googleConnected
              ? 'This item has no Google file attached yet. Delete and recreate it — new docs and sheets are now created in your Drive automatically.'
              : 'Connect your Google account once and Station 8 will create this file in your Drive automatically.'}
          </div>
          {!googleConnected && (
            <button className="gdrive-empty-cta" onClick={onConnectGoogle} type="button">
              <GoogleLogoIcon /> <span>Connect Google</span>
            </button>
          )}
        </div>
      </div>
    )
  }
  const embedUrl = readOnly ? toPreviewUrl(url) : url
  return (
    <div
      className={`gdrive-embed-wrap${readOnly ? ' is-readonly' : ''}`}
      data-kind={kind}
    >
      <iframe
        className="gdrive-embed-frame"
        src={embedUrl}
        title={doc.name}
        allow="clipboard-write; clipboard-read"
      />
    </div>
  )
}

// Best-effort rewrite of any Drive doc/sheet URL to the clean /preview form.
// Handles /edit, /edit?…, and already-preview URLs. Leaves unknown formats alone.
function toPreviewUrl(url) {
  return url
    .replace(/\/edit(\?.*)?$/, '/preview')
    .replace(/\?embedded=true.*$/, '')
}

function GDriveUrlField({ value, onChange, googleConnected, placeholder, kindLabel }) {
  return (
    <label className="modal-field gdrive-url-field">
      <span className="modal-field-label">
        {googleConnected ? 'Or import an existing Drive URL' : 'Google Drive URL'}
        {googleConnected ? (
          <span className="gdrive-url-hint">Leave empty to create a brand new {kindLabel} in your Drive automatically.</span>
        ) : (
          <span className="gdrive-url-hint">Paste a Drive URL you've shared as "anyone with link." Required until Google is connected.</span>
        )}
      </span>
      <input
        type="url"
        className="gdrive-url-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}
