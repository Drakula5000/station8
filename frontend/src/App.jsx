import { useEffect, useState, useCallback, useRef } from 'react'
import { Excalidraw, hashElementsVersion } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import Spreadsheet from 'react-spreadsheet'
import {
  makeSection, makeSticky, SECTION_COLORS, STICKY_COLORS,
  migrateLegacySections, isSectionElement, isSectionLabel
} from './sections'
import {
  BoardIcon, SheetIcon, FolderIcon, FolderOpenIcon, ChevronRightIcon, SearchIcon, CloseIcon,
  EmptyBoardIcon, TrashIcon,
  FjCursorIcon, FjHandIcon, FjStickyIcon, FjTextIcon, FjArrowIcon, FjPenIcon, FjSectionIcon,
  FjEllipseIcon, FjDiamondIcon, FjRectIcon, FjLineIcon, FjCleanStyleIcon, FjSketchStyleIcon,
  FjChevronDownIcon,
} from './icons'
import ConfirmationDialog from './components/ConfirmationDialog'
import ErrorToast from './components/ErrorToast'
import './App.css'

const API = import.meta.env.VITE_API_URL || ''
const ROOT_FOLDER = '__root__'
const WORKSPACE_SCOPE = '__workspace__'
const DEFAULT_SHEET = [
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
  [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
]

const compareByName = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })

const normalizeFolderValue = (value) => value === ROOT_FOLDER ? null : (value || null)

const folderKey = (folderId) => folderId || ROOT_FOLDER
const parseShareTokenFromPath = () => {
  const match = window.location.pathname.match(/^\/share\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}
const apiFetch = (path, options = {}) => fetch(`${API}${path}`, { ...options, credentials: 'include' })
const makeShareScopeValue = (type, id = '') => `${type}:${id || ''}`
const parseShareScopeValue = (value) => {
  const [scopeType, ...rest] = String(value || '').split(':')
  return { scopeType, scopeId: rest.join(':') || null }
}

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

export default function App() {
  const [boards, setBoards] = useState([])
  const [sheets, setSheets] = useState([])
  const [folders, setFolders] = useState([])
  const [expandedFolders, setExpandedFolders] = useState({})
  const [activeId, setActiveId] = useState(null) // { type: 'board'|'sheet', id }
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
  const excalidrawAPIRef = useRef(null)
  const excaliWrapRef = useRef(null)
  const saveTimer = useRef(null)
  const lastSceneVersionRef = useRef(null)
  const prevElementsRef = useRef([])
  const [sheetData, setSheetData] = useState(DEFAULT_SHEET)
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false)
  const [stickyPickerOpen, setStickyPickerOpen] = useState(false)
  const [lastStickyColor, setLastStickyColor] = useState('yellow')
  const [stickyPlacement, setStickyPlacement] = useState(null) // null | { color }
  const [stickyPreviewPos, setStickyPreviewPos] = useState(null) // { x, y } in px relative to excali-wrap
  const [shapePickerOpen, setShapePickerOpen] = useState(false)
  const [lastShape, setLastShape] = useState('ellipse')
  const [lastSectionColor, setLastSectionColor] = useState('blue')
  const [sketchMode, setSketchMode] = useState(false)
  const [activeTool, setActiveTool] = useState('selection')
  const [isDrawingSection, setIsDrawingSection] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [tagInputOpen, setTagInputOpen] = useState(false)
  // Auth + share route state
  const shareTokenFromPath = parseShareTokenFromPath()
  const readOnly = Boolean(shareTokenFromPath)
  const [studioChecked, setStudioChecked] = useState(readOnly)
  const [studioAuthenticated, setStudioAuthenticated] = useState(false)
  const [studioRequiresSetup, setStudioRequiresSetup] = useState(false)
  const [studioStatusError, setStudioStatusError] = useState('')
  const [studioPassword, setStudioPassword] = useState('')
  const [studioSetupPassword, setStudioSetupPassword] = useState('')
  const [visitorSetupPassword, setVisitorSetupPassword] = useState('')
  const [studioAuthBusy, setStudioAuthBusy] = useState(false)
  const [studioAuthError, setStudioAuthError] = useState('')
  const [shareChecked, setShareChecked] = useState(!readOnly)
  const [shareLocked, setShareLocked] = useState(readOnly)
  const [shareUnavailable, setShareUnavailable] = useState(false)
  const [sharePasswordInput, setSharePasswordInput] = useState('')
  const [shareUnlockBusy, setShareUnlockBusy] = useState(false)
  const [shareUnlockError, setShareUnlockError] = useState('')
  const [workspace, setWorkspace] = useState(null)
  const [shareMeta, setShareMeta] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState('')
  const [shares, setShares] = useState([])
  const [shareScopeValue, setShareScopeValue] = useState(makeShareScopeValue('workspace', WORKSPACE_SCOPE))
  const [shareLabel, setShareLabel] = useState('')
  const [shareCreateBusy, setShareCreateBusy] = useState(false)
  const [shareCreateError, setShareCreateError] = useState('')
  const [shareActionError, setShareActionError] = useState('')
  const [ownerPromptOpen, setOwnerPromptOpen] = useState(false)
  const [ownerPromptDismissed, setOwnerPromptDismissed] = useState(false)
  const [ownerInput, setOwnerInput] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [errorVisible, setErrorVisible] = useState(false)

  const folderById = buildFolderMap(folders)
  const folderOptions = [{ value: ROOT_FOLDER, label: 'Workspace root' }, ...buildFolderOptions(folders)]
  const activeBoard = boards.find(b => b.id === activeId?.id)
  const activeSheet = sheets.find(s => s.id === activeId?.id)
  const activeDoc = activeBoard || activeSheet || null
  const activeFolderPath = buildFolderPath(activeDoc?.folder_id, folderById)

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    if (readOnly) return
    let cancelled = false
    const statusPath = `/api/auth/status?_=${Date.now()}`
    apiFetch(statusPath, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 304) return { authenticated: false, requires_setup: true }
        if (!res.ok) throw new Error('auth status failed')
        const data = await res.json()
        return data
      })
      .then((data) => {
        if (!data || cancelled) return
        setStudioAuthenticated(Boolean(data.authenticated))
        setStudioRequiresSetup(Boolean(data.requires_setup))
        setStudioAuthError('')
        setStudioStatusError('')
      })
      .catch(() => {
        if (!cancelled) {
          setStudioAuthenticated(false)
          setStudioRequiresSetup(true)
          setStudioStatusError('')
        }
      })
      .finally(() => {
        if (!cancelled) setStudioChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [readOnly])

  const expandFolderPath = useCallback((folderId, folderList = folders) => {
    if (!folderId) return
    const nextFolderById = buildFolderMap(folderList)
    setExpandedFolders((current) => {
      const next = { ...current }
      let cursor = folderId
      while (cursor && nextFolderById[cursor]) {
        next[cursor] = true
        cursor = nextFolderById[cursor].parent_id || null
      }
      return next
    })
  }, [folders])

  const openDocument = useCallback((type, id, folderId = null) => {
    if (folderId) expandFolderPath(folderId)
    setActiveId({ type, id })
  }, [expandFolderPath])

  const refresh = useCallback(async () => {
    const currentActiveId = activeIdRef.current
    if (readOnly) {
      const res = await apiFetch(`/api/share/${shareTokenFromPath}`)
      setShareChecked(true)
      setShareUnavailable(false)
      if (res.status === 401) {
        setShareLocked(true)
        setShareMeta(null)
        return
      }
      if (!res.ok) {
        setShareUnavailable(true)
        return
      }
      const data = await res.json()
      setShareLocked(false)
      setShareMeta(data.share || null)
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
      if (data.boards?.length) {
        setActiveId((current) => current || { type: 'board', id: data.boards[0].id })
        if (!currentActiveId && data.boards[0].folder_id) expandFolderPath(data.boards[0].folder_id, nextFolders)
      } else if (data.sheets?.length) {
        setActiveId((current) => current || { type: 'sheet', id: data.sheets[0].id })
        if (!currentActiveId && data.sheets[0].folder_id) expandFolderPath(data.sheets[0].folder_id, nextFolders)
      }
      return
    }
    if (!studioAuthenticated) return
    const [boardsRes, sheetsRes, workspaceRes, sharesRes] = await Promise.all([
      apiFetch('/api/boards').catch(() => null),
      apiFetch('/api/sheets').catch(() => null),
      apiFetch('/api/workspace').catch(() => null),
      apiFetch('/api/shares').catch(() => null),
    ])
    if ([boardsRes, sheetsRes, workspaceRes].some((res) => !res || res.status === 401)) {
      setStudioAuthenticated(false)
      return
    }
    const [bs, ss, ws, shareList] = await Promise.all([
      boardsRes?.ok ? boardsRes.json() : [],
      sheetsRes?.ok ? sheetsRes.json() : [],
      workspaceRes?.ok ? workspaceRes.json() : null,
      sharesRes?.ok ? sharesRes.json() : [],
    ])
    setBoards(bs)
    setSheets(ss)
    setShares(Array.isArray(shareList) ? shareList : [])
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
    if (bs.length > 0) {
      setActiveId((current) => current || { type: 'board', id: bs[0].id })
      if (!currentActiveId && bs[0].folder_id) expandFolderPath(bs[0].folder_id, nextFolders)
    } else if (ss.length > 0) {
      setActiveId((current) => current || { type: 'sheet', id: ss[0].id })
      if (!currentActiveId && ss[0].folder_id) expandFolderPath(ss[0].folder_id, nextFolders)
    }
  }, [expandFolderPath, readOnly, shareTokenFromPath, ownerPromptDismissed, studioAuthenticated])

  useEffect(() => {
    refresh()
  }, [refresh])

  // ── board load/save ──
  const loadBoard = async (id) => {
    const url = readOnly
      ? `/api/share/${shareTokenFromPath}/board/${id}`
      : `/api/boards/${id}`
    const res = await apiFetch(url)
    if (!res.ok) return
    const data = await res.json()
    const snapshot = data.snapshot || { elements: [], appState: {}, files: {} }
    const elements = migrateLegacySections(snapshot.elements || [])
    prevElementsRef.current = elements
    if (excalidrawAPIRef.current) {
      excalidrawAPIRef.current.updateScene({
        elements,
        appState: { ...(snapshot.appState || {}), currentItemRoughness: sketchMode ? 1 : 0 },
      })
      if (snapshot.files) {
        excalidrawAPIRef.current.addFiles(Object.values(snapshot.files))
      }
      lastSceneVersionRef.current = hashElementsVersion(elements)
    }
  }

  const [saveState, setSaveState] = useState('idle') // 'idle' | 'saving' | 'ocr' | 'saved' | 'error'

  const dataURLtoBlob = (dataURL) => {
    const [header, data] = dataURL.split(',')
    const mime = header.match(/:(.*?);/)[1]
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { blob: new Blob([bytes], { type: mime }), mime }
  }

  const uploadNewImages = async (files) => {
    const api = excalidrawAPIRef.current
    if (!api || !files) return files
    const updated = { ...files }
    const toUpload = Object.entries(files).filter(
      ([, f]) => f && typeof f.dataURL === 'string' && f.dataURL.startsWith('data:')
    )
    if (toUpload.length === 0) return updated
    setSaveState('ocr')
    const uploads = await Promise.all(toUpload.map(async ([id, f]) => {
      const { blob, mime } = dataURLtoBlob(f.dataURL)
      const ext = (mime.split('/')[1] || 'png').split('+')[0]
      const form = new FormData()
      form.append('file', new File([blob], `img.${ext}`, { type: mime }))
      try {
        const res = await apiFetch('/api/upload', { method: 'POST', body: form })
        if (!res.ok) return null
        const data = await res.json()
        return { id, url: data.url, mime }
      } catch {
        return null
      }
    }))
    for (const u of uploads) {
      if (!u) continue
      const absolute = new URL(u.url, window.location.origin).href
      updated[u.id] = { ...files[u.id], dataURL: absolute, mimeType: u.mime }
      api.addFiles([updated[u.id]])
    }
    return updated
  }

  const saveBoard = useCallback(async () => {
    if (readOnly) return
    if (!activeId || activeId.type !== 'board' || !excalidrawAPIRef.current) return
    setSaveState('saving')
    try {
      const elements = excalidrawAPIRef.current.getSceneElements()
      const appState = excalidrawAPIRef.current.getAppState()
      const files = excalidrawAPIRef.current.getFiles()
      const uploadedFiles = await uploadNewImages(files)
      setSaveState('saving')
      const snapshot = {
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          theme: appState.theme,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom,
        },
        files: uploadedFiles,
      }
      const res = await apiFetch(`/api/boards/${activeId.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaveState('saved')
      setTimeout(() => setSaveState(s => s === 'saved' ? 'idle' : s), 1200)
    } catch (e) {
      console.error(e)
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 2500)
    }
  }, [activeId, readOnly])

  const scheduleSaveBoard = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { saveBoard() }, 1000)
  }, [saveBoard])

  // ── sheet load/save ──
  const loadSheet = async (id) => {
    const url = readOnly
      ? `/api/share/${shareTokenFromPath}/sheet/${id}`
      : `/api/sheets/${id}`
    const res = await apiFetch(url)
    if (!res.ok) return
    const data = await res.json()
    setSheetData(data.data && data.data.length ? data.data : DEFAULT_SHEET)
  }

  const saveSheet = useCallback(async (data) => {
    if (readOnly) return
    if (!activeId || activeId.type !== 'sheet') return
    await apiFetch(`/api/sheets/${activeId.id}`, {
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
    if (!activeId) return
    if (activeId.type === 'board') {
      // Give Excalidraw a frame to mount
      setTimeout(() => loadBoard(activeId.id), 50)
    } else {
      loadSheet(activeId.id)
    }
  }, [activeId])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.shiftKey && e.key === 'S') {
        e.preventDefault()
        addSection(lastSectionColor)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        setNewBoardOpen(false)
        setNewSheetOpen(false)
        setNewFolderOpen(false)
        setSectionPickerOpen(false)
        setStickyPickerOpen(false)
        setShapePickerOpen(false)
        setStickyPlacement(null)
        setStickyPreviewPos(null)
      }
    }
    const onClick = (e) => {
      if (!e.target.closest('.section-btn-wrap')) setSectionPickerOpen(false)
      if (!e.target.closest('.shape-btn-wrap')) setShapePickerOpen(false)
      if (!e.target.closest('.sticky-btn-wrap')) setStickyPickerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [])
  // ── Sticky placement mode: preview + click-to-drop on canvas ──
  useEffect(() => {
    if (!stickyPlacement) {
      setStickyPreviewPos(null)
      return
    }
    const wrap = excaliWrapRef.current
    if (!wrap) return

    const onMove = (e) => {
      const rect = wrap.getBoundingClientRect()
      setStickyPreviewPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }

    const onPointerDown = (e) => {
      if (e.button !== 0) return
      // Ignore clicks originating from the toolbar or other UI chrome.
      if (e.target.closest('.fj-toolbar') || e.target.closest('.fj-section-panel')) return
      const api = excalidrawAPIRef.current
      if (!api) return
      const rect = wrap.getBoundingClientRect()
      const appState = api.getAppState()
      const zoom = appState.zoom?.value || 1
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const sceneX = px / zoom - appState.scrollX
      const sceneY = py / zoom - appState.scrollY
      e.preventDefault()
      e.stopPropagation()
      dropStickyAtScene(sceneX, sceneY, stickyPlacement.color)
      setStickyPlacement(null)
      setStickyPreviewPos(null)
    }

    wrap.addEventListener('mousemove', onMove)
    wrap.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      wrap.removeEventListener('mousemove', onMove)
      wrap.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [stickyPlacement])


  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const url = readOnly
        ? `/api/share/${shareTokenFromPath}/search`
        : '/api/search'
      const res = await apiFetch(url, {
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

  const loginToStudio = async () => {
    const password = studioPassword.trim()
    if (!password) return
    setStudioAuthBusy(true)
    setStudioAuthError('')
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (res.status === 409 && data.requires_setup) {
          setStudioRequiresSetup(true)
        }
        setStudioAuthError(data.error || 'Wrong password')
        return
      }
      setStudioAuthenticated(true)
      setStudioRequiresSetup(false)
      setStudioPassword('')
    } catch {
      setStudioAuthError('Could not reach the backend. Restart the dev server and try again.')
    } finally {
      setStudioChecked(true)
      setStudioAuthBusy(false)
    }
  }

  const setupAccessPasswords = async () => {
    const ownerPassword = studioSetupPassword.trim()
    const visitorPassword = visitorSetupPassword.trim()
    if (!ownerPassword || !visitorPassword) {
      setStudioAuthError('Add both passwords to continue.')
      return
    }
    setStudioAuthBusy(true)
    setStudioAuthError('')
    try {
      const res = await apiFetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_password: ownerPassword,
          visitor_password: visitorPassword,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStudioAuthError(data.error || 'Could not save passwords')
        return
      }
      setStudioAuthenticated(true)
      setStudioRequiresSetup(false)
      setStudioSetupPassword('')
      setVisitorSetupPassword('')
    } catch {
      setStudioAuthError('Could not save passwords because the backend is unavailable.')
    } finally {
      setStudioChecked(true)
      setStudioAuthBusy(false)
    }
  }

  const logoutStudio = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    setStudioAuthenticated(false)
    setBoards([])
    setSheets([])
    setFolders([])
    setWorkspace(null)
    setShares([])
    setActiveId(null)
  }

  const unlockShare = async () => {
    const password = sharePasswordInput.trim()
    if (!password) return
    setShareUnlockBusy(true)
    setShareUnlockError('')
    try {
      const res = await apiFetch('/api/visitor/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setShareUnlockError(data.error || 'Wrong password')
        return
      }
      setSharePasswordInput('')
      setShareLocked(false)
      await refresh()
    } catch {
      setShareUnlockError('Could not reach the backend. Try refreshing the page.')
    } finally {
      setShareChecked(true)
      setShareUnlockBusy(false)
    }
  }

  const openShareModal = () => {
    const defaultScope = activeBoard
      ? makeShareScopeValue('board', activeBoard.id)
      : activeSheet
        ? makeShareScopeValue('sheet', activeSheet.id)
        : activeDoc?.folder_id
          ? makeShareScopeValue('folder', activeDoc.folder_id)
          : makeShareScopeValue('workspace', WORKSPACE_SCOPE)
    setShareScopeValue(defaultScope)
    setShareLabel('')
    setShareCreateError('')
    setShareActionError('')
    setShareOpen(true)
  }

  const copyShareLink = async (share) => {
    const url = new URL(share.url || `/share/${share.token}`, window.location.origin).toString()
    await navigator.clipboard.writeText(url)
    setCopied(share.id)
    setTimeout(() => setCopied((current) => current === share.id ? '' : current), 1500)
  }

  const createShareLink = async () => {
    const { scopeType, scopeId } = parseShareScopeValue(shareScopeValue)
    setShareCreateBusy(true)
    setShareCreateError('')
    setShareActionError('')
    try {
      const res = await apiFetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: scopeType === 'workspace' ? null : scopeId,
          label: shareLabel.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setShareCreateError(data.error || 'Could not create share link')
        return
      }
      setShares((current) => [data, ...current])
      setShareLabel('')
      setCopied('')
    } finally {
      setShareCreateBusy(false)
    }
  }

  const revokeShareLink = async (shareId) => {
    setShareActionError('')
    const res = await apiFetch(`/api/shares/${shareId}`, { method: 'DELETE' })
    if (!res.ok) {
      setShareActionError('Could not revoke that share link.')
      return
    }
    setShares((current) => current.map((share) => (
      share.id === shareId ? { ...share, revoked: true } : share
    )))
  }

  const createBoard = async () => {
    const name = newBoardName.trim()
    if (!name) return
    const res = await apiFetch('/api/boards', {
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
    const res = await apiFetch('/api/sheets', {
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
    const res = await apiFetch('/api/folders', {
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
    const res = await apiFetch(`/api/${endpoint}/${activeId.id}`, {
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
    const res = await apiFetch(`/api/${endpoint}/${activeId.id}`, {
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

  const renderDocItem = (doc, depth = 0) => (
    <button
      key={`${doc.type}-${doc.id}`}
      className={`sb-item tree-row tree-doc ${activeId?.type === doc.type && activeId.id === doc.id ? 'active' : ''}`}
      style={{ paddingLeft: `${10 + depth * 18}px` }}
      onClick={() => openDocument(doc.type, doc.id, doc.folder_id)}
      type="button"
    >
      {doc.type === 'board' ? <BoardIcon/> : <SheetIcon/>}
      <span className="sb-item-label">{doc.name}</span>
    </button>
  )

  const renderFolderNode = (folder, depth = 0) => {
    if (tagFilter && !folderHasVisibleContent(folder.id)) return null
    const expanded = expandedFolders[folder.id] !== false
    const childFolders = foldersByParent[folderKey(folder.id)] || []
    const childDocs = docsByFolder[folderKey(folder.id)] || []
    return (
      <div key={folder.id}>
        <button
          className={`sb-item tree-row tree-folder ${expanded ? 'folder-open' : ''}`}
          style={{ paddingLeft: `${10 + depth * 18}px` }}
          onClick={() => toggleFolder(folder.id)}
          type="button"
        >
          <span className={`tree-chevron ${expanded ? 'open' : ''}`}><ChevronRightIcon/></span>
          {expanded ? <FolderOpenIcon/> : <FolderIcon/>}
          <span className="sb-item-label">{folder.name}</span>
          {!readOnly && (
            <button
              className="folder-delete-btn"
              onClick={(e) => {
                e.stopPropagation()
                setDeleteTarget({ type: 'folder', id: folder.id, name: folder.name })
                setDeleteConfirmOpen(true)
              }}
              title="Delete folder"
              type="button"
            >
              <TrashIcon />
            </button>
          )}
        </button>
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
  const shareScopeOptions = [
    { value: makeShareScopeValue('workspace', WORKSPACE_SCOPE), label: 'Whole workspace' },
    ...[...folders]
      .sort(compareByName)
      .map((folder) => ({
        value: makeShareScopeValue('folder', folder.id),
        label: `Folder · ${buildFolderPath(folder.id, folderById) || folder.name}`,
      })),
    ...[...boards]
      .sort(compareByName)
      .map((board) => ({
        value: makeShareScopeValue('board', board.id),
        label: `Board · ${board.name}`,
      })),
    ...[...sheets]
      .sort(compareByName)
      .map((sheet) => ({
        value: makeShareScopeValue('sheet', sheet.id),
        label: `Sheet · ${sheet.name}`,
      })),
  ]

  const getSelectedIds = (api) => {
    const appState = api.getAppState()
    return new Set(Object.keys(appState.selectedElementIds || {}))
  }

  const getSelectedSectionIds = (api) => {
    const selectedIds = getSelectedIds(api)
    const selectedSections = new Set()
    const sceneElements = api.getSceneElements()
    for (const element of sceneElements) {
      if (selectedIds.has(element.id)) {
        if (isSectionElement(element)) {
          selectedSections.add(element.id)
        } else if (isSectionLabel(element)) {
          selectedSections.add(element.customData.sectionId)
        }
      }
    }
    return selectedSections
  }

  const getSelectedStickyIds = (api) => {
    const selectedIds = getSelectedIds(api)
    return new Set(
      api.getSceneElements()
        .filter(element => selectedIds.has(element.id) && element.customData?.isSticky)
        .map(element => element.id)
    )
  }

  const closeToolPickers = () => {
    setSectionPickerOpen(false)
    setStickyPickerOpen(false)
    setShapePickerOpen(false)
  }

  const addSection = (color) => {
    const api = excalidrawAPIRef.current
    if (!api) return
    api.setActiveTool({ type: 'rectangle' })
    setActiveTool('rectangle')
    setIsDrawingSection(true)
    setLastSectionColor(color)
    setSectionPickerOpen(false)
  }

  const beginStickyPlacement = (color = 'yellow') => {
    const api = excalidrawAPIRef.current
    if (api) {
      api.setActiveTool({ type: 'selection' })
    }
    setActiveTool('selection')
    setLastStickyColor(color)
    setStickyPickerOpen(false)
    setStickyPlacement({ color })
  }

  const dropStickyAtScene = (sceneX, sceneY, color) => {
    const api = excalidrawAPIRef.current
    if (!api) return
    const size = 180
    const newEls = makeSticky({ x: sceneX - size / 2, y: sceneY - size / 2, size, color })
    const elements = [...api.getSceneElements(), ...newEls]
    api.updateScene({
      elements,
      // Leave selection empty during placement so the tool stays active for rapid multi-drop.
      appState: { selectedElementIds: {} },
      captureUpdate: 'IMMEDIATELY',
    })
  }

  const addSticky = (color = 'yellow') => {
    // Toggle: if already arming this color, cancel; otherwise enter placement mode.
    if (stickyPlacement && stickyPlacement.color === color) {
      setStickyPlacement(null)
      setStickyPreviewPos(null)
      return
    }
    beginStickyPlacement(color)
  }

  const applySectionColor = (color) => {
    const api = excalidrawAPIRef.current
    if (!api) return
    const selectedSectionIds = getSelectedSectionIds(api)
    if (selectedSectionIds.size === 0) {
      addSection(color)
      return
    }

    const nextColor = SECTION_COLORS[color] || SECTION_COLORS.blue
    const elements = api.getSceneElements().map((element) => {
      if (selectedSectionIds.has(element.id) && isSectionElement(element)) {
        return {
          ...element,
          strokeColor: nextColor.stroke,
          backgroundColor: nextColor.bg,
          customData: { ...element.customData, sectionColor: color },
        }
      }
      if (isSectionLabel(element) && selectedSectionIds.has(element.customData?.sectionId)) {
        return {
          ...element,
          strokeColor: nextColor.stroke,
        }
      }
      return element
    })

    api.updateScene({ elements, captureUpdate: 'IMMEDIATELY' })
    setLastSectionColor(color)
    setSectionPickerOpen(false)
  }

  const applyStickyColor = (color) => {
    const api = excalidrawAPIRef.current
    if (!api) return
    const selectedStickyIds = getSelectedStickyIds(api)
    if (selectedStickyIds.size === 0) {
      beginStickyPlacement(color)
      return
    }

    const nextColor = STICKY_COLORS[color] || STICKY_COLORS.yellow
    const elements = api.getSceneElements().map((element) => {
      if (!selectedStickyIds.has(element.id) || !element.customData?.isSticky) return element
      return {
        ...element,
        backgroundColor: nextColor.bg,
        customData: { ...element.customData, stickyColor: color },
      }
    })

    api.updateScene({ elements, captureUpdate: 'IMMEDIATELY' })
    setLastStickyColor(color)
    setStickyPickerOpen(false)
  }

  const setTool = (type) => {
    const api = excalidrawAPIRef.current
    if (!api) return
    closeToolPickers()
    api.setActiveTool({ type, locked: false })
    api.updateScene({ appState: { currentItemRoughness: sketchMode ? 1 : 0 } })
    setActiveTool(type)
  }

  const setShapeTool = (shape) => {
    setLastShape(shape)
    setTool(shape)
  }

  const toggleSketch = () => {
    setSketchMode(m => {
      const next = !m
      const api = excalidrawAPIRef.current
      if (api) api.updateScene({ appState: { currentItemRoughness: next ? 1 : 0 } })
      return next
    })
  }

  const saveOwner = async () => {
    const name = ownerInput.trim()
    if (!name) return
    await apiFetch('/api/workspace', {
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
        ? `/api/folders/${deleteTarget.id}`
        : deleteTarget.type === 'board'
          ? `/api/boards/${deleteTarget.id}`
          : `/api/sheets/${deleteTarget.id}`

      const res = await apiFetch(endpoint, { method: 'DELETE' })
      if (!res.ok) {
        showError(res.status === 404 ? 'Item not found' : 'Delete failed')
        return
      }

      if (deleteTarget.type === 'folder') {
        await refresh()
      } else if (deleteTarget.type === 'board') {
        setBoards((current) => current.filter((board) => board.id !== deleteTarget.id))
        if (activeId?.id === deleteTarget.id) setActiveId(null)
      } else {
        setSheets((current) => current.filter((sheet) => sheet.id !== deleteTarget.id))
        if (activeId?.id === deleteTarget.id) setActiveId(null)
      }

      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
    } catch {
      showError('Delete failed')
    }
  }

  if (!readOnly && !studioChecked) {
    return <GateScreen title="Checking access" subtitle="Loading your studio…" />
  }

  if (!readOnly && !studioAuthenticated) {
    if (studioRequiresSetup) {
      return (
        <SetupAccessGate
          workspacePassword={studioSetupPassword}
          onWorkspacePasswordChange={setStudioSetupPassword}
          visitorPassword={visitorSetupPassword}
          onVisitorPasswordChange={setVisitorSetupPassword}
          onSubmit={setupAccessPasswords}
          error={studioAuthError || studioStatusError}
          busy={studioAuthBusy}
        />
      )
    }
    return (
      <PasswordGate
        title="Research Studio"
        subtitle="Enter the workspace password to open the full workspace."
        password={studioPassword}
        onPasswordChange={setStudioPassword}
        onSubmit={loginToStudio}
        error={studioAuthError}
        busy={studioAuthBusy}
        buttonLabel="Enter studio"
      />
    )
  }

  if (readOnly && !shareChecked) {
    return <GateScreen title="Checking share link" subtitle="Loading this shared view…" />
  }

  if (readOnly && shareLocked) {
    return (
      <PasswordGate
        title={shareMeta?.title || 'Shared research'}
        subtitle="This link is protected. Enter the visitor password to view it."
        password={sharePasswordInput}
        onPasswordChange={setSharePasswordInput}
        onSubmit={unlockShare}
        error={shareUnlockError}
        busy={shareUnlockBusy}
        buttonLabel="Open share"
      />
    )
  }

  if (readOnly && shareUnavailable) {
    return <GateScreen title="Share unavailable" subtitle="This link no longer exists, or it has been revoked." />
  }

  if (!workspace) {
    return <GateScreen title="Loading workspace" subtitle="Pulling in boards, folders, and sheets…" />
  }

  return (
    <div className="app">
      {readOnly && (
        <div className="readonly-banner">
          <strong>Read-only view.</strong> {shareMeta?.title || workspace?.name || 'Research'} shared by {workspace?.owner || 'the owner'}. You can browse and search; you cannot edit.
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">{workspace?.name || 'Research'}</div>

        {!readOnly && (
          <div className="sidebar-actions">
            <button className="sidebar-action" onClick={openNewFolderModal} type="button"><FolderIcon/> Folder</button>
            <button className="sidebar-action" onClick={openNewBoardModal} type="button"><BoardIcon/> Board</button>
            <button className="sidebar-action" onClick={openNewSheetModal} type="button"><SheetIcon/> Sheet</button>
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
                <button className="sb-add" onClick={() => setTagFilter(null)} title="Clear filter" type="button"><CloseIcon/></button>
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
          <span className="search-btn-label"><SearchIcon/> Search</span>
          <span className="kbd">⌘F</span>
        </button>
      </aside>

      <main className="canvas-wrap">
        <div className="topbar">
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
            <div className="topbar-actions">
              {activeDoc && (
                <button
                  className="delete-doc-btn"
                  onClick={() => {
                    setDeleteTarget({
                      type: activeId.type,
                      id: activeId.id,
                      name: activeDoc.name
                    })
                    setDeleteConfirmOpen(true)
                  }}
                  title={`Delete ${activeId.type}`}
                  type="button"
                >
                  <TrashIcon />
                </button>
              )}
              {saveState !== 'idle' && (
                <span className={`save-indicator save-${saveState}`}>
                  {saveState === 'saving' && '· saving…'}
                  {saveState === 'ocr' && '· indexing images…'}
                  {saveState === 'saved' && '✓ saved'}
                  {saveState === 'error' && '! save failed'}
                </span>
              )}
              <button className="share-btn" onClick={openShareModal} type="button">Share</button>
              <button className="topbar-logout" onClick={logoutStudio} type="button">Logout</button>
            </div>
          )}
        </div>
        <div className="work-area">
          {activeId?.type === 'board' && (
            <div
              className={`excali-wrap${stickyPlacement ? ' sticky-placing' : ''}`}
              key={activeId.id}
              ref={excaliWrapRef}
            >
              <Excalidraw
                excalidrawAPI={(api) => { excalidrawAPIRef.current = api }}
                onChange={(elements, appState) => {
                  const api = excalidrawAPIRef.current
                  if (!api) return
                  
                  if (appState?.activeTool?.type && activeTool !== appState.activeTool.type) {
                    setActiveTool(appState.activeTool.type)
                  }

                  let nextElements = elements
                  let didChangeElements = false

                  // ─── 1. Handle New Section (Frame) Stylization ───
                  if (isDrawingSection && appState.activeTool.type === 'selection') {
                    const latest = elements[elements.length - 1]
                    if (latest && latest.type === 'frame' && !latest.customData?.isSection) {
                      const stylized = makeSection({
                        x: latest.x,
                        y: latest.y,
                        w: latest.width,
                        h: latest.height,
                        color: lastSectionColor,
                        name: 'Untitled section',
                        id: latest.id
                      })
                      nextElements = [...elements.slice(0, -1), ...stylized]
                      didChangeElements = true
                    }
                    setIsDrawingSection(false)
                  }

                  // ─── 2. LOD Label Legibility ───
                  const zoom = appState?.zoom?.value || 1
                  const baseFontSize = 24
                  const targetFontSize = Math.max(baseFontSize, Math.min(64, baseFontSize / zoom))
                  
                  if (Math.abs(targetFontSize - baseFontSize) > 1) {
                    const lodElements = nextElements.map(el => {
                      if (isSectionLabel(el) && Math.abs(el.fontSize - targetFontSize) > 1) {
                        didChangeElements = true
                        return { ...el, fontSize: targetFontSize }
                      }
                      return el
                    })
                    if (didChangeElements) nextElements = lodElements
                  }

                  if (didChangeElements) {
                    api.updateScene({ elements: nextElements })
                  }

                  prevElementsRef.current = nextElements

                  // ─── 3. UI State Sync ───
                  const selectedIds = new Set(Object.keys(appState?.selectedElementIds || {}))
                  const selectedSection = nextElements.find((element) => {
                    if (selectedIds.has(element.id) && isSectionElement(element)) return true
                    if (isSectionLabel(element) && selectedIds.has(element.id)) return true
                    return false
                  })
                  const sectionColor = selectedSection?.customData?.sectionColor || 
                    (selectedSection?.customData?.sectionId && nextElements.find(el => el.id === selectedSection.customData.sectionId)?.customData?.sectionColor)
                  
                  if (sectionColor && sectionColor !== lastSectionColor && SECTION_COLORS[sectionColor]) {
                    setLastSectionColor(sectionColor)
                  }

                  const selectedSticky = nextElements.find((element) => selectedIds.has(element.id) && element.customData?.stickyColor && element.customData?.isSticky)
                  if (selectedSticky?.customData?.stickyColor && selectedSticky.customData.stickyColor !== lastStickyColor && STICKY_COLORS[selectedSticky.customData.stickyColor]) {
                    setLastStickyColor(selectedSticky.customData.stickyColor)
                  }

                  if (readOnly) return
                  const v = hashElementsVersion(nextElements)
                  if (v === lastSceneVersionRef.current) return
                  lastSceneVersionRef.current = v
                  scheduleSaveBoard()
                }}
                theme="light"
                viewModeEnabled={readOnly}
              />
              {stickyPlacement && stickyPreviewPos && (() => {
                const api = excalidrawAPIRef.current
                const zoom = api?.getAppState?.().zoom?.value || 1
                const size = 180 * zoom
                const c = STICKY_COLORS[stickyPlacement.color] || STICKY_COLORS.yellow
                return (
                  <div
                    className="sticky-ghost"
                    style={{
                      left: stickyPreviewPos.x - size / 2,
                      top: stickyPreviewPos.y - size / 2,
                      width: size,
                      height: size,
                      background: c.bg,
                      borderColor: c.stroke,
                    }}
                  />
                )
              })()}
              {!readOnly && (
                <div className="fj-toolbar">
                  <button className={`fj-tool ${activeTool === 'selection' ? 'active' : ''}`}
                          onClick={() => setTool('selection')} title="Select (V)" type="button"><FjCursorIcon/></button>
                  <button className={`fj-tool ${activeTool === 'hand' ? 'active' : ''}`}
                          onClick={() => setTool('hand')} title="Hand (H)" type="button"><FjHandIcon/></button>
                  <div className="fj-sep"/>
                  <div className="sticky-btn-wrap">
                    <div className={`fj-split ${stickyPickerOpen ? 'open' : ''}`}>
                      <button className={`fj-tool fj-tool-main ${stickyPlacement ? 'active' : ''}`}
                              onClick={() => addSticky(lastStickyColor)}
                              title={stickyPlacement ? 'Click canvas to place sticky (Esc to cancel)' : 'Sticky note'}
                              type="button">
                        <FjStickyIcon color={lastStickyColor}/>
                      </button>
                      <button
                        className={`fj-tool fj-tool-caret ${stickyPickerOpen ? 'active' : ''}`}
                        onClick={() => { setStickyPickerOpen(o => !o); setSectionPickerOpen(false); setShapePickerOpen(false) }}
                        title="Sticky colors"
                        type="button"
                      >
                        <FjChevronDownIcon/>
                      </button>
                    </div>
                    {stickyPickerOpen && (
                      <div className="section-picker" onClick={(e) => e.stopPropagation()}>
                        <div className="section-picker-title">Sticky color</div>
                        <div className="section-picker-grid">
                          {Object.entries(STICKY_COLORS).map(([key, c]) => (
                            <button
                              key={key}
                              className="section-swatch"
                              style={{ background: c.bg, borderColor: c.stroke }}
                              title={key}
                              onClick={() => applyStickyColor(key)}
                              type="button"
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="shape-btn-wrap">
                    <div className={`fj-split ${shapePickerOpen ? 'open' : ''}`}>
                      <button
                        className={`fj-tool fj-tool-main ${['ellipse', 'diamond', 'rectangle', 'line'].includes(activeTool) ? 'active' : ''}`}
                        onClick={() => setShapeTool(lastShape)}
                        title="Shapes"
                        type="button">
                        {lastShape === 'diamond' ? <FjDiamondIcon/>
                          : lastShape === 'rectangle' ? <FjRectIcon/>
                            : lastShape === 'line' ? <FjLineIcon/>
                              : <FjEllipseIcon/>}
                      </button>
                      <button
                        className={`fj-tool fj-tool-caret ${shapePickerOpen ? 'active' : ''}`}
                        onClick={() => { setShapePickerOpen(o => !o); setStickyPickerOpen(false); setSectionPickerOpen(false) }}
                        title="Shape picker"
                        type="button"
                      >
                        <FjChevronDownIcon/>
                      </button>
                    </div>
                    {shapePickerOpen && (
                      <div className="shape-picker" onClick={(e) => e.stopPropagation()}>
                        <button className="shape-option" onClick={() => { setShapeTool('rectangle'); setShapePickerOpen(false) }} title="Rectangle" type="button">
                          <FjRectIcon/>
                        </button>
                        <button className="shape-option" onClick={() => { setShapeTool('ellipse'); setShapePickerOpen(false) }} title="Ellipse" type="button">
                          <FjEllipseIcon/>
                        </button>
                        <button className="shape-option" onClick={() => { setShapeTool('diamond'); setShapePickerOpen(false) }} title="Diamond" type="button">
                          <FjDiamondIcon/>
                        </button>
                        <button className="shape-option" onClick={() => { setShapeTool('line'); setShapePickerOpen(false) }} title="Line" type="button">
                          <FjLineIcon/>
                        </button>
                      </div>
                    )}
                  </div>
                  <button className={`fj-tool ${activeTool === 'text' ? 'active' : ''}`}
                          onClick={() => setTool('text')} title="Text (T)" type="button"><FjTextIcon/></button>
                  <button className={`fj-tool ${activeTool === 'arrow' ? 'active' : ''}`}
                          onClick={() => setTool('arrow')} title="Connector (X)" type="button"><FjArrowIcon/></button>
                  <button className={`fj-tool ${activeTool === 'freedraw' ? 'active' : ''}`}
                          onClick={() => setTool('freedraw')} title="Marker (M)" type="button"><FjPenIcon/></button>
                  <div className="fj-sep"/>
                  <button className={`fj-tool ${sketchMode ? 'active' : ''}`}
                          onClick={toggleSketch}
                          title={sketchMode ? 'Sketch style (click for clean)' : 'Clean style (click for sketch)'}
                          type="button">
                    {sketchMode ? <FjSketchStyleIcon/> : <FjCleanStyleIcon/>}
                  </button>
                  <div className="fj-sep"/>
                  <div className="section-btn-wrap">
                    <div className={`fj-split ${sectionPickerOpen ? 'open' : ''}`}>
                      <button className="fj-tool fj-tool-main"
                              onClick={() => addSection(lastSectionColor)}
                              title="Section"
                              type="button"><FjSectionIcon/></button>
                      <button
                        className={`fj-tool fj-tool-caret ${sectionPickerOpen ? 'active' : ''}`}
                        onClick={() => setSectionPickerOpen(o => !o)}
                        title="Section colors"
                        type="button"
                      >
                        <FjChevronDownIcon/>
                      </button>
                    </div>
                    {sectionPickerOpen && (
                      <div className="section-picker" onClick={(e) => e.stopPropagation()}>
                        <div className="section-picker-title">Section color</div>
                        <div className="section-picker-grid">
                          {Object.entries(SECTION_COLORS).map(([key, c]) => (
                            <button
                              key={key}
                              className="section-swatch"
                              style={{ background: c.bg, borderColor: c.stroke }}
                              title={c.label}
                              onClick={() => applySectionColor(key)}
                              type="button"
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {activeId?.type === 'sheet' && (
            <div className="sheet-wrap" key={activeId.id}>
              {readOnly ? (
                <ReadOnlySheet data={sheetData}/>
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
                <EmptyBoardIcon style={{ color: '#ccc', marginBottom: 10 }}/>
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
          <FolderField
            label="Create in"
            value={newBoardFolderId}
            options={folderOptions}
            onChange={setNewBoardFolderId}
          />
          <ModalFooter onCancel={() => setNewBoardOpen(false)} onConfirm={createBoard} disabled={!newBoardName.trim()} />
        </Modal>
      )}

      {newSheetOpen && (
        <Modal onClose={() => setNewSheetOpen(false)} title="New sheet">
          <input autoFocus value={newSheetName}
                 onChange={e => setNewSheetName(e.target.value)}
                 placeholder="Name this sheet"
                 onKeyDown={e => { if (e.key === 'Enter') createSheet() }} />
          <FolderField
            label="Create in"
            value={newSheetFolderId}
            options={folderOptions}
            onChange={setNewSheetFolderId}
          />
          <ModalFooter onCancel={() => setNewSheetOpen(false)} onConfirm={createSheet} disabled={!newSheetName.trim()} />
        </Modal>
      )}

      {newFolderOpen && (
        <Modal onClose={() => setNewFolderOpen(false)} title="New folder">
          <input autoFocus value={newFolderName}
                 onChange={e => setNewFolderName(e.target.value)}
                 placeholder="Name this folder"
                 onKeyDown={e => { if (e.key === 'Enter') createFolder() }} />
          <FolderField
            label="Parent folder"
            value={newFolderParentId}
            options={folderOptions}
            onChange={setNewFolderParentId}
          />
          <ModalFooter onCancel={() => setNewFolderOpen(false)} onConfirm={createFolder} disabled={!newFolderName.trim()} />
        </Modal>
      )}

      {shareOpen && workspace && (
        <Modal onClose={() => setShareOpen(false)} title="Create a share link">
          <div className="share-body">
            <div className="share-desc">
              Create a password-protected read-only link for a board, folder, sheet, or the whole workspace.
            </div>
            <label className="modal-field">
              <span className="modal-field-label">What are you sharing?</span>
              <select className="folder-select" value={shareScopeValue} onChange={(e) => setShareScopeValue(e.target.value)}>
                {shareScopeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="modal-field">
              <span className="modal-field-label">Optional label</span>
              <input
                value={shareLabel}
                onChange={(e) => setShareLabel(e.target.value)}
                placeholder="Project alpha folder"
              />
            </label>
            <div className="share-desc share-note">
              All share links use the same visitor password.
            </div>
            {shareCreateError && <div className="share-error">{shareCreateError}</div>}
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setShareOpen(false)} type="button">Close</button>
              <button className="btn-primary" onClick={createShareLink} disabled={shareCreateBusy} type="button">
                {shareCreateBusy ? 'Creating…' : 'Create link'}
              </button>
            </div>
            <div className="share-list">
              {shares.length === 0 && <div className="share-empty">No share links yet.</div>}
              {shares.map((share) => (
                <div key={share.id} className={`share-item ${share.revoked ? 'is-revoked' : ''}`}>
                  <div className="share-item-meta">
                    <div className="share-item-title">{share.label || share.title}</div>
                    <div className="share-item-subtitle">{share.scope_type} share</div>
                  </div>
                  <div className="share-url-row">
                    <input
                      readOnly
                      className="share-url"
                      value={new URL(share.url || `/share/${share.token}`, window.location.origin).toString()}
                      onFocus={(e) => e.target.select()}
                    />
                    <button className="btn-primary" disabled={share.revoked} onClick={() => copyShareLink(share)} type="button">
                      {copied === share.id ? 'Copied' : 'Copy'}
                    </button>
                    <button className="btn-ghost" disabled={share.revoked} onClick={() => revokeShareLink(share.id)} type="button">
                      {share.revoked ? 'Revoked' : 'Revoke'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {shareActionError && <div className="share-error">{shareActionError}</div>}
            <div className="share-owner-row">
              <label>Your display name:</label>
              <input
                className="share-owner-input"
                value={workspace.owner || ''}
                onChange={(e) => setWorkspace(w => ({ ...w, owner: e.target.value }))}
                onBlur={async (e) => {
                  await apiFetch('/api/workspace', {
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

      <ConfirmationDialog
        open={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false)
          setDeleteTarget(null)
        }}
        onConfirm={handleDelete}
        itemType={deleteTarget?.type || ''}
        itemName={deleteTarget?.name || ''}
        consequences={
          deleteTarget?.type === 'folder'
            ? 'All items in this folder will be moved to its parent folder. Child folders will also be moved.'
            : deleteTarget?.type === 'board'
            ? 'This board and all its content will be permanently deleted.'
            : 'This sheet and all its data will be permanently deleted.'
        }
      />

      <ErrorToast
        message={errorMessage}
        visible={errorVisible}
        onDismiss={() => {
          setErrorVisible(false)
          setTimeout(() => setErrorMessage(null), 300)
        }}
      />
    </div>
  )
}

function GateScreen({ title, subtitle }) {
  return (
    <div className="gate-shell">
      <div className="gate-card gate-card-static">
        <div className="gate-eyebrow">YOUR_DOMAIN</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

function PasswordGate({ title, subtitle, password, onPasswordChange, onSubmit, error, busy, buttonLabel }) {
  return (
    <div className="gate-shell">
      <div className="gate-card">
        <div className="gate-eyebrow">YOUR_DOMAIN</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onSubmit()
          }}
          placeholder="Password"
        />
        {error && <div className="gate-error">{error}</div>}
        <button className="btn-primary gate-submit" onClick={onSubmit} disabled={busy || !password.trim()} type="button">
          {busy ? 'Checking…' : buttonLabel}
        </button>
      </div>
    </div>
  )
}

function SetupAccessGate({
  workspacePassword,
  onWorkspacePasswordChange,
  visitorPassword,
  onVisitorPasswordChange,
  onSubmit,
  error,
  busy,
}) {
  return (
    <div className="gate-shell">
      <div className="gate-card">
        <div className="gate-eyebrow">YOUR_DOMAIN</div>
        <h1>Set up access</h1>
        <p>Create one password for the full workspace and one password for anyone opening shared links.</p>
        <input
          autoFocus
          type="password"
          value={workspacePassword}
          onChange={(e) => onWorkspacePasswordChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onSubmit()
          }}
          placeholder="Owner password"
        />
        <input
          type="password"
          value={visitorPassword}
          onChange={(e) => onVisitorPasswordChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onSubmit()
          }}
          placeholder="Visitor password"
          style={{ marginTop: 10 }}
        />
        {error && <div className="gate-error">{error}</div>}
        <button
          className="btn-primary gate-submit"
          onClick={onSubmit}
          disabled={busy || !workspacePassword.trim() || !visitorPassword.trim()}
          type="button"
        >
          {busy ? 'Saving…' : 'Save passwords'}
        </button>
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
