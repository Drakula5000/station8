import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, useEditor, track, DefaultColorStyle, GeoShapeGeoStyle, FrameShapeUtil } from 'tldraw'
import 'tldraw/tldraw.css'
import {
  FjCursorIcon, FjHandIcon, FjStickyIcon, FjTextIcon, FjArrowIcon, FjPenIcon, FjSectionIcon,
  FjEllipseIcon, FjDiamondIcon, FjRectIcon, FjLineIcon, FjChevronDownIcon,
} from './icons'
import { ShapeInspector } from './components/ShapeInspector'

const API = import.meta.env.VITE_API_URL || ''

// Send uploads through our Flask endpoint so /api/upload can OCR the image and
// index it in data/ocr.json. Without this tldraw stores images as inline data
// URLs, which are huge in the snapshot and invisible to server-side search.
const assetStore = {
  async upload(_asset, file) {
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(`${API}/api/upload`, {
      method: 'POST',
      credentials: 'include',
      body,
    })
    if (!res.ok) throw new Error('upload failed')
    const { url } = await res.json()
    return { src: url }
  },
  resolve(asset) {
    return asset.props.src || null
  },
}

// Hide tldraw's default UI chrome.
// Bottom toolbar is replaced by FjToolbar; right-side StylePanel is replaced
// by ShapeInspector (floats near the selection with our research vocabulary).
const TLDRAW_COMPONENTS = {
  Toolbar: null,
  StylePanel: null,
  PageMenu: null,
  MainMenu: null,
  HelpMenu: null,
  DebugMenu: null,
  DebugPanel: null,
}

const STICKY_SWATCHES = {
  yellow: { bg: '#C8B0F5', tl: 'light-violet' },
  pink:   { bg: '#F0A8C0', tl: 'light-red' },
  blue:   { bg: '#90BCE8', tl: 'light-blue' },
  green:  { bg: '#88D4B0', tl: 'light-green' },
  orange: { bg: '#F0B880', tl: 'orange' },
  purple: { bg: '#B8A0F8', tl: 'violet' },
}

// tldraw NOTE_SIZE is hardcoded at 200 canvas units; scale it down on placement
const NOTE_DEFAULT_SCALE = 0.6

const FRAME_SHAPE_UTILS = [FrameShapeUtil.configure({ showColors: true })]

// Reactive component that injects per-frame corner-radius CSS.
// React 19 hoists <style> tags into <head> automatically.
const FrameCornerStyles = track(function FrameCornerStyles() {
  const editor = useEditor()
  const frames = editor.getCurrentPageShapes().filter(
    s => s.type === 'frame' && Number(s.meta?.cornerRadius) > 0
  )
  if (frames.length === 0) return null
  const css = frames.map(f => {
    const rx = Number(f.meta.cornerRadius)
    const id = f.id
    return [
      `[data-shape-id="${id}"] .tl-frame__body { rx: ${rx}px }`,
      `[data-shape-id="${id}"] .tl-frame-heading,`,
      `[data-shape-id="${id}"] .tl-frame-heading-hit-area { border-radius: ${rx * 12 / 32}px }`,
    ].join('\n')
  }).join('\n')
  return <style>{css}</style>
})

const SECTION_SWATCHES = {
  violet: { bg: '#ede8ff', stroke: '#7c5ce8', tl: 'violet' },   // aurora accent
  teal:   { bg: '#d8f5f0', stroke: '#15c4b0', tl: 'green' },    // aurora teal
  blue:   { bg: '#ddeeff', stroke: '#3a80d8', tl: 'blue' },
  rose:   { bg: '#ffe8f0', stroke: '#d84a80', tl: 'light-red' },
  amber:  { bg: '#fff0d8', stroke: '#c88030', tl: 'orange' },
  slate:  { bg: '#e8ecf4', stroke: '#607090', tl: 'grey' },
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

const FjToolbar = track(function FjToolbar({ toolInfoRef }) {
  const editor = useEditor()
  const [stickyPickerOpen, setStickyPickerOpen] = useState(false)
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false)
  const [shapePickerOpen, setShapePickerOpen] = useState(false)
  const [lastStickyColor, setLastStickyColor] = useState('yellow')
  const [lastSectionColor, setLastSectionColor] = useState('violet')
  const [lastShape, setLastShape] = useState('ellipse')

  const currentTool = editor.getCurrentToolId()

  // Keep toolInfoRef in sync so TldrawCanvas can render the ghost
  if (toolInfoRef) {
    toolInfoRef.current.tool = currentTool
    toolInfoRef.current.stickyColor = lastStickyColor
    toolInfoRef.current.zoom = editor.getZoomLevel()
  }

  useEffect(() => {
    const onClick = (e) => {
      if (!e.target.closest('.sticky-btn-wrap')) setStickyPickerOpen(false)
      if (!e.target.closest('.section-btn-wrap')) setSectionPickerOpen(false)
      if (!e.target.closest('.shape-btn-wrap')) setShapePickerOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setStickyPickerOpen(false)
        setSectionPickerOpen(false)
        setShapePickerOpen(false)
      }
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const closeAll = () => {
    setStickyPickerOpen(false)
    setSectionPickerOpen(false)
    setShapePickerOpen(false)
  }

  const setTool = (tool) => {
    editor.setCurrentTool(tool)
    closeAll()
  }

  const placeNote = (color) => {
    setLastStickyColor(color)
    if (toolInfoRef) toolInfoRef.current.stickyColor = color
    try { editor.setStyleForNextShapes(DefaultColorStyle, STICKY_SWATCHES[color]?.tl || 'yellow') } catch {}
    editor.setCurrentTool('note')
    setStickyPickerOpen(false)
  }

  const placeFrame = (color) => {
    setLastSectionColor(color)
    try { editor.setStyleForNextShapes(DefaultColorStyle, SECTION_SWATCHES[color]?.tl || 'blue') } catch {}
    editor.setCurrentTool('frame')
    setSectionPickerOpen(false)
  }

  const setShape = (shape) => {
    setLastShape(shape)
    if (shape === 'line') {
      editor.setCurrentTool('line')
    } else {
      try { editor.setStyleForNextShapes(GeoShapeGeoStyle, shape) } catch {}
      editor.setCurrentTool('geo')
    }
    closeAll()
  }

  return (
    <>
    <div className="fj-toolbar">
      <button
        className={`fj-tool ${currentTool === 'select' ? 'active' : ''}`}
        onClick={() => setTool('select')}
        title="Select"
        type="button"
      ><FjCursorIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'hand' ? 'active' : ''}`}
        onClick={() => setTool('hand')}
        title="Hand"
        type="button"
      ><FjHandIcon /></button>

      <div className="fj-sep" />

      {/* Sticky notes */}
      <div className="sticky-btn-wrap">
        <div className={`fj-split ${stickyPickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${currentTool === 'note' ? 'active' : ''}`}
            onClick={() => placeNote(lastStickyColor)}
            title="Sticky note"
            type="button"
          ><FjStickyIcon color={lastStickyColor} /></button>
          <button
            className={`fj-tool fj-tool-caret ${stickyPickerOpen ? 'active' : ''}`}
            onClick={() => { setStickyPickerOpen(o => !o); setSectionPickerOpen(false); setShapePickerOpen(false) }}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {stickyPickerOpen && (
          <div className="section-picker" onClick={e => e.stopPropagation()}>
            <div className="section-picker-title">Sticky color</div>
            <div className="section-picker-grid">
              {Object.entries(STICKY_SWATCHES).map(([key, c]) => (
                <button
                  key={key}
                  className="section-swatch"
                  style={{ background: c.bg }}
                  onClick={() => placeNote(key)}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sections / frames */}
      <div className="section-btn-wrap">
        <div className={`fj-split ${sectionPickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${currentTool === 'frame' ? 'active' : ''}`}
            onClick={() => placeFrame(lastSectionColor)}
            title="Section"
            type="button"
          ><FjSectionIcon /></button>
          <button
            className={`fj-tool fj-tool-caret ${sectionPickerOpen ? 'active' : ''}`}
            onClick={() => { setSectionPickerOpen(o => !o); setStickyPickerOpen(false); setShapePickerOpen(false) }}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {sectionPickerOpen && (
          <div className="section-picker" onClick={e => e.stopPropagation()}>
            <div className="section-picker-title">Section color</div>
            <div className="section-picker-grid">
              {Object.entries(SECTION_SWATCHES).map(([key, c]) => (
                <button
                  key={key}
                  className="section-swatch"
                  style={{ background: c.bg, borderColor: c.stroke }}
                  onClick={() => placeFrame(key)}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Shapes */}
      <div className="shape-btn-wrap">
        <div className={`fj-split ${shapePickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${['geo', 'line'].includes(currentTool) ? 'active' : ''}`}
            onClick={() => setShape(lastShape)}
            title="Shapes"
            type="button"
          >
            {lastShape === 'diamond' ? <FjDiamondIcon />
              : lastShape === 'rectangle' ? <FjRectIcon />
              : lastShape === 'line' ? <FjLineIcon />
              : <FjEllipseIcon />}
          </button>
          <button
            className={`fj-tool fj-tool-caret ${shapePickerOpen ? 'active' : ''}`}
            onClick={() => { setShapePickerOpen(o => !o); setStickyPickerOpen(false); setSectionPickerOpen(false) }}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {shapePickerOpen && (
          <div className="shape-picker" onClick={e => e.stopPropagation()}>
            <button className="shape-option" onClick={() => setShape('rectangle')} type="button"><FjRectIcon /></button>
            <button className="shape-option" onClick={() => setShape('ellipse')} type="button"><FjEllipseIcon /></button>
            <button className="shape-option" onClick={() => setShape('diamond')} type="button"><FjDiamondIcon /></button>
            <button className="shape-option" onClick={() => setShape('line')} type="button"><FjLineIcon /></button>
          </div>
        )}
      </div>

      <button
        className={`fj-tool ${currentTool === 'text' ? 'active' : ''}`}
        onClick={() => setTool('text')}
        title="Text"
        type="button"
      ><FjTextIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'arrow' ? 'active' : ''}`}
        onClick={() => setTool('arrow')}
        title="Connector"
        type="button"
      ><FjArrowIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'draw' ? 'active' : ''}`}
        onClick={() => setTool('draw')}
        title="Draw"
        type="button"
      ><FjPenIcon /></button>
    </div>
    </>
  )
})

export default function TldrawCanvas({ boardId, readOnly, viewerMode, shareSlug, onSaveState, colorMode }) {
  const boardIdRef = useRef(boardId)
  const readOnlyRef = useRef(readOnly)
  const viewerModeRef = useRef(viewerMode)
  const shareSlugRef = useRef(shareSlug)
  const onSaveStateRef = useRef(onSaveState)
  const saveTimerRef = useRef(null)
  const loadingRef = useRef(false)
  const cleanupRef = useRef(null)
  const wrapRef = useRef(null)
  const toolInfoRef = useRef({ tool: 'select', stickyColor: 'yellow' })
  const [ghost, setGhost] = useState(null) // { x, y, color } | null

  boardIdRef.current = boardId
  readOnlyRef.current = readOnly
  viewerModeRef.current = viewerMode
  shareSlugRef.current = shareSlug
  onSaveStateRef.current = onSaveState

  const editorRef = useRef(null)

  const doSave = useCallback(async () => {
    const editor = editorRef.current
    if (!editor || readOnlyRef.current) return
    const notify = onSaveStateRef.current
    notify?.('saving')
    try {
      const snap = editor.store.getStoreSnapshot()
      const res = await fetch(`${API}/api/boards/${boardIdRef.current}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ snapshot: snap }),
      })
      if (!res.ok) throw new Error('save failed')
      notify?.('saved')
      setTimeout(() => onSaveStateRef.current?.(s => s === 'saved' ? 'idle' : s), 1200)
    } catch {
      notify?.('error')
      setTimeout(() => onSaveStateRef.current?.('idle'), 2500)
    }
  }, [])

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.user.updateUserPreferences({ colorScheme: colorMode === 'light' ? 'light' : 'dark' })
    }
  }, [colorMode])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (isEditableTarget(e.target)) return
      // Prevent the browser from interpreting macOS Delete / Backspace as history navigation
      // while a board is open. Tldraw still receives the event and deletes selected shapes.
      e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => () => {
    cleanupRef.current?.()
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      doSave()
    }
  }, [doSave])

  const colorModeRef = useRef(colorMode)
  colorModeRef.current = colorMode

  const handleMount = useCallback((editor) => {
    editorRef.current = editor
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__tlEditor = editor
    editor.user.updateUserPreferences({ colorScheme: colorModeRef.current === 'light' ? 'light' : 'dark' })
    const bid = boardIdRef.current
    const ro = readOnlyRef.current
    const mode = viewerModeRef.current
    const slug = shareSlugRef.current

    loadingRef.current = true
    const url = ro && mode === 'share' && slug
      ? `${API}/api/share/${slug}/board/${bid}`
      : ro && mode === 'visitor'
      ? `${API}/api/visitor/boards/${bid}`
      : `${API}/api/boards/${bid}`

    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.snapshot?.store) {
          editor.store.loadStoreSnapshot(data.snapshot)
        }
      })
      .catch(err => console.error('board load failed', err))
      .finally(() => { loadingRef.current = false })

    const cleanupSave = editor.store.listen(
      () => {
        if (loadingRef.current || readOnlyRef.current) return
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null
          doSave()
        }, 600)
      },
      { scope: 'document' }
    )

    // Scale down newly placed notes; changes.added only fires for new shapes, not our own updateShape, so no loop
    const cleanupScale = editor.store.listen((entry) => {
      if (loadingRef.current) return
      const newNotes = Object.values(entry.changes.added).filter(
        r => r.typeName === 'shape' && r.type === 'note'
      )
      for (const note of newNotes) {
        editor.updateShape({ id: note.id, type: 'note', props: { scale: NOTE_DEFAULT_SCALE } })
      }
    }, { source: 'user', scope: 'document' })

    cleanupRef.current = () => { cleanupSave(); cleanupScale() }
  }, [doSave])

  const handleMouseMove = (e) => {
    if (toolInfoRef.current.tool !== 'note') {
      if (ghost) setGhost(null)
      return
    }
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setGhost({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      color: toolInfoRef.current.stickyColor,
      zoom: toolInfoRef.current.zoom || 1,
    })
  }

  const handleMouseLeave = () => setGhost(null)

  const handleWheelCapture = useCallback(() => {
    const editor = editorRef.current
    if (editor && !editor.getInstanceState().isFocused) {
      editor.focus()
    }
  }, [])

  const NOTE_CANVAS_SIZE = 200
  const ghostPx = ghost ? NOTE_CANVAS_SIZE * NOTE_DEFAULT_SCALE * ghost.zoom : 0
  const ghostBg = ghost ? (STICKY_SWATCHES[ghost.color]?.bg || '#C8B0F5') : null

  return (
    <div
      className={`tldraw-wrap${ghost ? ' sticky-placing' : ''}`}
      ref={wrapRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onWheelCapture={handleWheelCapture}
    >
      <Tldraw
        components={TLDRAW_COMPONENTS}
        onMount={handleMount}
        assets={assetStore}
        shapeUtils={FRAME_SHAPE_UTILS}
      >
        {!readOnly && <FjToolbar toolInfoRef={toolInfoRef} />}
        {!readOnly && <ShapeInspector />}
        <FrameCornerStyles />
      </Tldraw>
      {ghost && (
        <div
          className="sticky-ghost"
          style={{
            left: ghost.x - ghostPx / 2,
            top: ghost.y - ghostPx / 2,
            width: ghostPx,
            height: ghostPx,
            background: ghostBg,
          }}
        />
      )}
    </div>
  )
}
