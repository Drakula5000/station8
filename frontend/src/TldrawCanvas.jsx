import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Tldraw,
  useEditor,
  track,
  DefaultColorStyle,
  DefaultDashStyle,
  GeoShapeGeoStyle,
  FrameShapeUtil,
  TldrawUiButtonIcon,
} from 'tldraw'
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
    const src = asset.props.src || null
    if (!src) return null
    if (src.startsWith('/')) return `${API}${src}`
    return src
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
  NavigationPanel: null,
  ImageToolbar: null,
}

const STICKY_SWATCHES = {
  yellow: { bg: '#C8B0F5', tl: 'light-violet' },
  pink:   { bg: '#F0A8C0', tl: 'light-red' },
  blue:   { bg: '#90BCE8', tl: 'light-blue' },
  green:  { bg: '#88D4B0', tl: 'light-green' },
  orange: { bg: '#F0B880', tl: 'orange' },
  purple: { bg: '#B8A0F8', tl: 'violet' },
}

// tldraw NOTE_SIZE is hardcoded at 200 canvas units. Use dynamic size mode so
// newly placed notes stay a consistent on-screen size across zoom levels.
const NOTE_PREVIEW_SIZE = 200
const MAX_DROPPED_IMAGE_VIEWPORT_FRACTION = 0.2
const MAX_DROPPED_IMAGE_FRAME_FRACTION = 0.2
const FRAME_DROPPED_IMAGE_INSET = 32

const FRAME_SHAPE_UTILS = [FrameShapeUtil.configure({ showColors: true })]

function getNotePreviewSizePx(editor) {
  return NOTE_PREVIEW_SIZE * editor.getResizeScaleFactor() * editor.getZoomLevel()
}

function getContainedDimensions(w, h, maxW, maxH) {
  if (!(w > 0) || !(h > 0) || !(maxW > 0) || !(maxH > 0)) return null
  const scale = Math.min(1, maxW / w, maxH / h)
  if (scale >= 1) return null
  return { w: w * scale, h: h * scale }
}

function getDroppedImageResize(editor, shape) {
  if (shape.type !== 'image') return null

  const width = Number(shape.props?.w ?? 0)
  const height = Number(shape.props?.h ?? 0)
  if (!(width > 0) || !(height > 0)) return null

  const viewport = editor.getViewportPageBounds()
  let maxW = viewport.width * MAX_DROPPED_IMAGE_VIEWPORT_FRACTION
  let maxH = viewport.height * MAX_DROPPED_IMAGE_VIEWPORT_FRACTION

  const parent = editor.getShapeParent(shape)
  if (parent?.type === 'frame') {
    const frameInnerW = Math.max(1, parent.props.w - FRAME_DROPPED_IMAGE_INSET * 2)
    const frameInnerH = Math.max(1, parent.props.h - FRAME_DROPPED_IMAGE_INSET * 2)
    maxW = Math.min(maxW, frameInnerW * MAX_DROPPED_IMAGE_FRAME_FRACTION)
    maxH = Math.min(maxH, frameInnerH * MAX_DROPPED_IMAGE_FRAME_FRACTION)
  }

  const resized = getContainedDimensions(width, height, maxW, maxH)
  if (!resized) return null

  return {
    id: shape.id,
    type: 'image',
    x: shape.x + (width - resized.w) / 2,
    y: shape.y + (height - resized.h) / 2,
    props: {
      w: resized.w,
      h: resized.h,
    },
  }
}

// Stamps data-tl-color on each shape DOM node so CSS can remap tldraw's
// native dark-mode color palette to Aurora-appropriate values.
const ShapeColorSync = track(function ShapeColorSync() {
  const editor = useEditor()
  const shapes = editor.getCurrentPageShapes()
  useEffect(() => {
    shapes.forEach(shape => {
      const el = document.querySelector(`[data-shape-id="${shape.id}"]`)
      if (!el) return

      const color = shape.props?.color
      if (color) {
        el.setAttribute('data-tl-color', color)
      } else {
        el.removeAttribute('data-tl-color')
      }

      const size = shape.props?.size
      if (typeof size === 'string') {
        el.setAttribute('data-s8-size', size)
      } else {
        el.removeAttribute('data-s8-size')
      }

      if (shape.type === 'geo') {
        const fillColor = typeof shape.meta?.fillColor === 'string' ? shape.meta.fillColor : null
        const fillOpacity = typeof shape.meta?.fillOpacity === 'number' ? shape.meta.fillOpacity : 0

        if (fillColor && fillOpacity > 0) {
          el.setAttribute('data-geo-fill-custom', 'true')
          el.style.setProperty('--s8-geo-fill-color', fillColor)
          el.style.setProperty('--s8-geo-fill-opacity', String(fillOpacity))
        } else {
          el.removeAttribute('data-geo-fill-custom')
          el.style.removeProperty('--s8-geo-fill-color')
          el.style.removeProperty('--s8-geo-fill-opacity')
        }
      } else {
        el.removeAttribute('data-geo-fill-custom')
        el.style.removeProperty('--s8-geo-fill-color')
        el.style.removeProperty('--s8-geo-fill-opacity')
      }
    })
  })
  return null
})

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

const ImageShapeStyles = track(function ImageShapeStyles() {
  const editor = useEditor()
  const images = editor.getCurrentPageShapes().filter((s) => {
    if (s.type !== 'image') return false
    const hasExplicitCorners = Object.prototype.hasOwnProperty.call(s.meta ?? {}, 'imageCornerRadius')
    return hasExplicitCorners || Number(s.meta?.imageBorderWidth ?? 0) > 0
  })
  if (images.length === 0) return null

  const css = images.map((image) => {
    const id = image.id
    const radius = image.props.crop?.isCircle ? '50%' : `${Number(image.meta?.imageCornerRadius ?? 0)}px`
    const borderWidth = Number(image.meta?.imageBorderWidth ?? 0)
    const borderColor = image.meta?.imageBorderColor || 'var(--s8-accent)'
    const borderShadow = borderWidth > 0 ? `inset 0 0 0 ${borderWidth}px ${borderColor}` : 'none'

    return [
      `[data-shape-id="${id}"] .tl-html-container { position: relative; border-radius: ${radius}; overflow: hidden; }`,
      `[data-shape-id="${id}"] .tl-html-container::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: ${borderShadow}; pointer-events: none; }`,
      `[data-shape-id="${id}"] .tl-image-container,`,
      `[data-shape-id="${id}"] .tl-image { border-radius: inherit; }`,
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
  const [editingAltText, setEditingAltText] = useState(false)
  const [altTextDraft, setAltTextDraft] = useState('')
  const [lastStickyColor, setLastStickyColor] = useState('yellow')
  const [lastSectionColor, setLastSectionColor] = useState('violet')
  const [lastShape, setLastShape] = useState('ellipse')

  const currentTool = editor.getCurrentToolId()
  const selectedImage = editor.getOnlySelectedShape()?.type === 'image' ? editor.getOnlySelectedShape() : null

  useEffect(() => {
    if (!selectedImage) {
      setEditingAltText(false)
      setAltTextDraft('')
      return
    }
    setAltTextDraft(selectedImage.props.altText || '')
  }, [selectedImage])

  // Keep toolInfoRef in sync so TldrawCanvas can render the ghost
  if (toolInfoRef) {
    toolInfoRef.current.tool = currentTool
    toolInfoRef.current.stickyColor = lastStickyColor
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

  const stopToolbarPointer = (e) => {
    e.stopPropagation()
  }

  const startImageCrop = () => {
    if (!selectedImage) return
    editor.select(selectedImage.id)
    editor.setCurrentTool('select.crop.idle')
  }

  const replaceImage = async () => {
    if (!selectedImage) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) {
        editor.markHistoryStoppingPoint('replace image')
        editor.replaceExternalContent({
          type: 'file-replace',
          file,
          shapeId: selectedImage.id,
          isImage: true,
        })
      }
      input.remove()
    }, { once: true })
    input.click()
  }

  const downloadImage = async () => {
    if (!selectedImage) return
    if (!selectedImage.props.assetId) return
    const asset = editor.getAsset(selectedImage.props.assetId)
    if (!asset) return
    const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
    if (!url) return
    const resp = await fetch(url)
    if (!resp.ok) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    const blob = await resp.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = asset.props.name || 'image'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(link.href)
  }

  const saveAltText = () => {
    if (!selectedImage) return
    editor.updateShapes([{
      id: selectedImage.id,
      type: 'image',
      props: { altText: altTextDraft },
    }])
    setEditingAltText(false)
  }

  const setTool = (tool) => {
    editor.setCurrentTool(tool)
    closeAll()
  }

  const placeNote = (color) => {
    setLastStickyColor(color)
    if (toolInfoRef) toolInfoRef.current.stickyColor = color
    try { editor.setStyleForNextShapes(DefaultColorStyle, STICKY_SWATCHES[color]?.tl || 'yellow') } catch { /* no-op */ }
    editor.setCurrentTool('note')
    setStickyPickerOpen(false)
  }

  const placeFrame = (color) => {
    setLastSectionColor(color)
    try { editor.setStyleForNextShapes(DefaultColorStyle, SECTION_SWATCHES[color]?.tl || 'blue') } catch { /* no-op */ }
    editor.setCurrentTool('frame')
    setSectionPickerOpen(false)
  }

  const setShape = (shape) => {
    setLastShape(shape)
    if (shape === 'line') {
      editor.setCurrentTool('line')
    } else {
      try { editor.setStyleForNextShapes(GeoShapeGeoStyle, shape) } catch { /* no-op */ }
      try {
        editor.setStyleForNextShapes(
          DefaultDashStyle,
          shape === 'rectangle' || shape === 'diamond' ? 'solid' : 'draw'
        )
      } catch { /* no-op */ }
      editor.setCurrentTool('geo')
    }
    closeAll()
  }

  return (
    <>
    <div
      className="fj-toolbar"
      onPointerDownCapture={stopToolbarPointer}
      onMouseDownCapture={stopToolbarPointer}
    >
      <button
        className={`fj-tool ${currentTool === 'select' ? 'active' : ''}`}
        onClick={() => setTool('select')}
        onPointerDown={stopToolbarPointer}
        title="Select"
        type="button"
      ><FjCursorIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'hand' ? 'active' : ''}`}
        onClick={() => setTool('hand')}
        onPointerDown={stopToolbarPointer}
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
            onPointerDown={stopToolbarPointer}
            title="Sticky note"
            type="button"
          ><FjStickyIcon color={lastStickyColor} /></button>
          <button
            className={`fj-tool fj-tool-caret ${stickyPickerOpen ? 'active' : ''}`}
            onClick={() => { setStickyPickerOpen(o => !o); setSectionPickerOpen(false); setShapePickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
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
            onPointerDown={stopToolbarPointer}
            title="Section"
            type="button"
          ><FjSectionIcon /></button>
          <button
            className={`fj-tool fj-tool-caret ${sectionPickerOpen ? 'active' : ''}`}
            onClick={() => { setSectionPickerOpen(o => !o); setStickyPickerOpen(false); setShapePickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
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
            onPointerDown={stopToolbarPointer}
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
            onPointerDown={stopToolbarPointer}
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
        onPointerDown={stopToolbarPointer}
        title="Text"
        type="button"
      ><FjTextIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'arrow' ? 'active' : ''}`}
        onClick={() => setTool('arrow')}
        onPointerDown={stopToolbarPointer}
        title="Connector"
        type="button"
      ><FjArrowIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'draw' ? 'active' : ''}`}
        onClick={() => setTool('draw')}
        onPointerDown={stopToolbarPointer}
        title="Draw"
        type="button"
      ><FjPenIcon /></button>

      {selectedImage && (
        <>
          <div className="fj-sep" />
          <button
            className="fj-tool"
            onClick={replaceImage}
            onPointerDown={stopToolbarPointer}
            title="Replace image"
            type="button"
          ><TldrawUiButtonIcon small icon="tool-media" /></button>
          <button
            className={`fj-tool ${currentTool.startsWith('select.crop') ? 'active' : ''}`}
            onClick={startImageCrop}
            onPointerDown={stopToolbarPointer}
            title="Crop image"
            type="button"
          ><TldrawUiButtonIcon small icon="crop" /></button>
          <button
            className="fj-tool"
            onClick={downloadImage}
            onPointerDown={stopToolbarPointer}
            title="Download original"
            type="button"
          ><TldrawUiButtonIcon small icon="download" /></button>
          {editingAltText ? (
            <div
              className="fj-alt-wrap"
              onPointerDownCapture={stopToolbarPointer}
              onMouseDownCapture={stopToolbarPointer}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                className="fj-alt-input"
                value={altTextDraft}
                onChange={(e) => setAltTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAltText()
                  if (e.key === 'Escape') setEditingAltText(false)
                }}
                placeholder="Alt text"
              />
              <button
                className="fj-mini-btn"
                onClick={saveAltText}
                onPointerDown={stopToolbarPointer}
                title="Save alt text"
                type="button"
              ><TldrawUiButtonIcon small icon="check" /></button>
            </div>
          ) : (
            <button
              className={`fj-tool ${selectedImage.props.altText ? 'active' : ''}`}
              onClick={() => setEditingAltText(true)}
              onPointerDown={stopToolbarPointer}
              title="Edit alt text"
              type="button"
            ><span className="fj-alt-label">ALT</span></button>
          )}
        </>
      )}
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
  const pointerRef = useRef(null)
  const [ghost, setGhost] = useState(null) // { x, y, color } | null

  const editorRef = useRef(null)

  useEffect(() => {
    boardIdRef.current = boardId
    readOnlyRef.current = readOnly
    viewerModeRef.current = viewerMode
    shareSlugRef.current = shareSlug
    onSaveStateRef.current = onSaveState
  }, [boardId, readOnly, viewerMode, shareSlug, onSaveState])

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
      editorRef.current.user.updateUserPreferences({
        colorScheme: colorMode === 'light' ? 'light' : 'dark',
        isSnapMode: true,
        isDynamicSizeMode: true,
      })
    }
  }, [colorMode])

  const updateGhost = useCallback((clientX, clientY) => {
    if (toolInfoRef.current.tool !== 'note') {
      setGhost(null)
      return
    }
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setGhost({
      x: clientX - rect.left,
      y: clientY - rect.top,
      color: toolInfoRef.current.stickyColor,
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (isEditableTarget(e.target)) return

      const key = e.key.toLowerCase()
      const hasAccel = e.metaKey || e.ctrlKey

      if (!readOnly && hasAccel && key === 'z') {
        e.preventDefault()
        const editor = editorRef.current
        if (!editor) return
        editor.focus()
        if (e.shiftKey) {
          editor.redo()
        } else {
          editor.undo()
        }
        return
      }

      if (!readOnly && hasAccel && key === 'y') {
        e.preventDefault()
        const editor = editorRef.current
        if (!editor) return
        editor.focus()
        editor.redo()
        return
      }

      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      // Prevent the browser from interpreting macOS Delete / Backspace as history navigation
      // while a board is open. Tldraw still receives the event and deletes selected shapes.
      e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [readOnly])

  useEffect(() => () => {
    cleanupRef.current?.()
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      doSave()
    }
  }, [doSave])

  const colorModeRef = useRef(colorMode)
  useEffect(() => {
    colorModeRef.current = colorMode
  }, [colorMode])

  const handleMount = useCallback((editor) => {
    editorRef.current = editor
    editor.user.updateUserPreferences({
      colorScheme: colorModeRef.current === 'light' ? 'light' : 'dark',
      isSnapMode: true,
      isDynamicSizeMode: true,
    })
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

    const cleanupDroppedImages = editor.store.listen((entry) => {
      if (loadingRef.current) return
      const newImages = Object.values(entry.changes.added).filter(
        r => r.typeName === 'shape' && r.type === 'image'
      )
      const updates = newImages
        .map((image) => {
          const shape = editor.getShape(image.id)
          return shape ? getDroppedImageResize(editor, shape) : null
        })
        .filter(Boolean)
      if (updates.length) {
        editor.updateShapes(updates)
      }
    }, { source: 'user', scope: 'document' })

    cleanupRef.current = () => {
      cleanupSave()
      cleanupDroppedImages()
    }
  }, [doSave])

  const handleMouseMove = (e) => {
    pointerRef.current = { clientX: e.clientX, clientY: e.clientY }
    updateGhost(e.clientX, e.clientY)
  }

  const handleMouseLeave = () => {
    pointerRef.current = null
    setGhost(null)
  }

  const handleWheelCapture = useCallback(() => {
    const editor = editorRef.current
    if (editor && !editor.getInstanceState().isFocused) {
      editor.focus()
    }
    requestAnimationFrame(() => {
      const pointer = pointerRef.current
      if (!pointer) return
      updateGhost(pointer.clientX, pointer.clientY)
    })
  }, [updateGhost])

  const ghostPx = ghost && editorRef.current
    ? getNotePreviewSizePx(editorRef.current)
    : 0
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
        options={{ snapThreshold: 10 }}
        shapeUtils={FRAME_SHAPE_UTILS}
      >
        {!readOnly && <FjToolbar toolInfoRef={toolInfoRef} />}
        {!readOnly && <ShapeInspector />}
        <FrameCornerStyles />
        <ImageShapeStyles />
        <ShapeColorSync />
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
