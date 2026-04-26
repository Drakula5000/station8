import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, FrameShapeUtil } from 'tldraw'
import 'tldraw/tldraw.css'
import { ShapeInspector } from './components/ShapeInspector'
import { ImageLightbox } from './components/ImageLightbox'
import { STICKY_SWATCHES } from './colors'
import { ShapeColorSync } from './canvas/ShapeColorSync'
import { FrameCornerStyles, GeoCornerStyles, ImageShapeStyles, ListStyles } from './canvas/ShapeStyles'
import { BrokenImageRetry } from './canvas/BrokenImageRetry'
import { FindBar } from './canvas/FindBar'
import { FjToolbar } from './canvas/FjToolbar'
import { isEditableTarget, resolveImageShapeUrl } from './canvas/shared'

const API = import.meta.env.VITE_API_URL || ''

// Direct-resolved Supabase signed URLs for `/uploads/<name>` references,
// populated from the board-load response. Lets images load straight from the
// Supabase CDN instead of bouncing every request through the slow Render
// backend. Module-scoped so the static assetStore can read it.
const signedUploadUrls = new Map()

// eslint-disable-next-line react-refresh/only-export-components
export function setSignedUploadUrls(map) {
  if (!map) return
  for (const [name, url] of Object.entries(map)) {
    if (url) signedUploadUrls.set(name, url)
  }
}

// Send uploads through our Flask endpoint so they're indexed for search. OCR
// runs in the browser (Tesseract.js) because Render's Python native runtime
// can't install the tesseract binary; the extracted text rides along as a
// form field. Without this tldraw would store images as inline data URLs.
const assetStore = {
  async upload(_asset, file) {
    // Lazy-load ocr.js only when an owner actually uploads — keeps tesseract.js
    // out of the visitor bundle entirely (visitors can't upload).
    const { ocrImage } = await import('./ocr')
    const ocrText = await ocrImage(file)
    const body = new FormData()
    body.append('file', file)
    body.append('ocr_text', ocrText)
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
    if (src.startsWith('/uploads/')) {
      const filename = src.slice('/uploads/'.length)
      const signed = signedUploadUrls.get(filename)
      if (signed) return signed
    }
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
const READONLY_TLDRAW_COMPONENTS = {
  ...TLDRAW_COMPONENTS,
  ShapeIndicators: null,
  SelectionBackground: null,
  SelectionForeground: null,
}

// tldraw NOTE_SIZE is hardcoded at 200 canvas units. Use dynamic size mode so
// newly placed notes stay a consistent on-screen size across zoom levels.
const NOTE_PREVIEW_SIZE = 200
const MAX_DROPPED_IMAGE_VIEWPORT_FRACTION = 0.2
const MAX_DROPPED_IMAGE_FRAME_FRACTION = 0.2
const FRAME_DROPPED_IMAGE_INSET = 32
const FRAME_SHAPE_UTILS = [FrameShapeUtil.configure({ showColors: true })]
const FIGMA_REORDER_SHORTCUTS = {
  bringForward: 'cmd+],ctrl+]',
  bringToFront: 'cmd+alt+],ctrl+shift+]',
  sendBackward: 'cmd+[,ctrl+[',
  sendToBack: 'cmd+alt+[,ctrl+shift+[',
}

const TLDRAW_UI_OVERRIDES = {
  actions(_editor, actions) {
    return {
      ...actions,
      'bring-forward': {
        ...actions['bring-forward'],
        kbd: FIGMA_REORDER_SHORTCUTS.bringForward,
      },
      'bring-to-front': {
        ...actions['bring-to-front'],
        kbd: FIGMA_REORDER_SHORTCUTS.bringToFront,
      },
      'send-backward': {
        ...actions['send-backward'],
        kbd: FIGMA_REORDER_SHORTCUTS.sendBackward,
      },
      'send-to-back': {
        ...actions['send-to-back'],
        kbd: FIGMA_REORDER_SHORTCUTS.sendToBack,
      },
    }
  },
}

function getVisibleContentBounds(editor) {
  // Compute the page-space bounds of everything a user can see:
  //   - every frame's own rectangle (frames visually clip their children,
  //     so the frame bounds already account for anything inside)
  //   - every shape that is NOT inside a frame (floating on the page)
  // Shapes inside a frame are intentionally skipped — their stored w/h can
  // exceed the frame (e.g. text with a huge props.w) and would pull the fit
  // box far past the last visible content.
  const shapes = editor.getCurrentPageShapes()
  if (shapes.length === 0) return null

  const isInsideFrame = (shape) => {
    let cur = shape
    while (cur) {
      const parent = editor.getShapeParent(cur)
      if (!parent) return false
      if (parent.type === 'frame') return true
      cur = parent
    }
    return false
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of shapes) {
    if (s.type !== 'frame' && isInsideFrame(s)) continue
    const b = editor.getShapePageBounds(s.id)
    if (!b) continue
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  if (!isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function fitBoardAfterOpen(editor, onComplete) {
  // Poll until the visible-content bounds stabilise, then zoom to them.
  // Excludes the overflow of shapes nested inside frames (wide text etc.)
  // since frames clip those visually — including them would push the fit
  // box past the last visible content and leave the viewport off-center.
  // `onComplete` fires when the fit finishes (or when no bounds ever resolve);
  // callers use it to reveal the canvas after the camera lands, hiding the
  // brief flash of saved-zoom content from the snapshot.
  let attempts = 0
  let done = false
  const MAX_ATTEMPTS = 40
  const INTERVAL_MS = 100
  let lastSignature = null

  const finish = () => {
    if (done) return
    done = true
    onComplete?.()
  }

  const doFit = (bounds) => {
    // loadStoreSnapshot replaces instance_state, which includes screenBounds.
    // Tldraw's centering math in zoomToBounds reads that stored screenBounds
    // instead of re-measuring the DOM, so without this re-measure the fit
    // centres against whatever window size the board was last saved at.
    // When today's viewport is wider/taller than that, content renders
    // shifted toward the top-left.
    const container = editor.getContainer()
    if (container) editor.updateViewportScreenBounds(container)
    editor.zoomToBounds(bounds, { immediate: true, inset: 64 })
    finish()
  }

  const tryFit = () => {
    const bounds = getVisibleContentBounds(editor) ?? editor.getCurrentPageBounds()
    if (bounds && bounds.w > 0 && bounds.h > 0) {
      const signature = `${bounds.x}|${bounds.y}|${bounds.w}|${bounds.h}`
      if (signature === lastSignature) {
        doFit(bounds)
        return
      }
      lastSignature = signature
    }
    attempts++
    if (attempts < MAX_ATTEMPTS) {
      window.setTimeout(tryFit, INTERVAL_MS)
    } else if (lastSignature) {
      const fallback = getVisibleContentBounds(editor) ?? editor.getCurrentPageBounds()
      if (fallback) doFit(fallback)
      else finish()
    } else {
      // Empty board / no shapes — nothing to fit, just reveal as-is.
      finish()
    }
  }

  window.setTimeout(tryFit, 150)
}

function getNotePreviewSizePx(editor) {
  return NOTE_PREVIEW_SIZE * editor.getResizeScaleFactor() * editor.getZoomLevel()
}

function getContainedDimensions(w, h, maxW, maxH) {
  if (!(w > 0) || !(h > 0) || !(maxW > 0) || !(maxH > 0)) return null
  const scale = Math.min(1, maxW / w, maxH / h)
  if (scale >= 1) return null
  return { w: w * scale, h: h * scale }
}

function getDroppedImageTargetSize(editor, shape) {
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
  return resized || { w: width, h: height }
}

export default function TldrawCanvas({ boardId, readOnly, viewerMode, shareSlug, onSaveState, colorMode, findQuery, onFindDismiss, findBoards, onNavigateBoard, findShapeIds }) {
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
  const [lightbox, setLightbox] = useState(null) // { src, alt } | null
  const [hoverAffordance, setHoverAffordance] = useState({ cursor: '', tooltip: '' })
  // Hide the canvas until the post-load fit-to-bounds completes; the snapshot
  // restores whatever zoom the board was saved at, so without this gate users
  // see a brief flash of oversized content before the camera lands.
  const [boardFitting, setBoardFitting] = useState(true)

  const editorRef = useRef(null)
  const openLightboxRef = useRef(null)

  const openLightbox = useCallback((info) => {
    if (!info?.src) return
    setLightbox(info)
  }, [])

  openLightboxRef.current = openLightbox
  const closeLightbox = useCallback(() => setLightbox(null), [])

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

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateInstanceState({ isReadonly: readOnly })
    }
    if (!readOnly) {
      setHoverAffordance({ cursor: '', tooltip: '' })
    }
  }, [readOnly])

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

    editor.updateInstanceState({ isReadonly: ro })

    loadingRef.current = true
    const url = ro && mode === 'share' && slug
      ? `${API}/api/share/${slug}/board/${bid}`
      : ro && mode === 'visitor'
      ? `${API}/api/visitor/boards/${bid}`
      : `${API}/api/boards/${bid}`

    // Single fetch → single store load → single fit. No localStorage cache.
    // The previous stale-while-revalidate cache saved ~300ms on warm Render
    // but caused a visible double-paint flicker and a camera race on cold
    // loads where the cached-bounds fit fired against stale data before the
    // fresh snapshot replaced it. Keep the code path identical for owner
    // and visitor.
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.asset_urls) setSignedUploadUrls(data.asset_urls)
        if (data?.snapshot?.store) {
          editor.store.loadStoreSnapshot(data.snapshot)
        }
      })
      .catch(err => {
        console.error('board load failed', err)
      })
      .finally(() => {
        loadingRef.current = false
        // Re-apply read-only AFTER snapshot load. loadStoreSnapshot replaces
        // the entire store including the instance_state record, which
        // silently resets isReadonly to whatever the snapshot was saved
        // with (usually false). Without this, visitors can select + delete
        // shapes locally even though saves are blocked.
        editor.updateInstanceState({ isReadonly: ro })
        if (ro) {
          editor.selectNone()
          editor.setHoveredShape(null)
        }
        fitBoardAfterOpen(editor, () => setBoardFitting(false))
      })

    const defaultFilesHandler = editor.externalContentHandlers.files
    editor.registerExternalContentHandler('files', async (externalContent) => {
      const { files, point } = externalContent
      const mediaFiles = files.filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
      const otherFiles = files.filter((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'))

      if (mediaFiles.length && defaultFilesHandler) {
        const originalZoomToSelection = editor.zoomToSelection
        editor.zoomToSelection = () => editor
        try {
          await defaultFilesHandler({ ...externalContent, files: mediaFiles, point })
        } finally {
          editor.zoomToSelection = originalZoomToSelection
        }
      }

      if (otherFiles.length && defaultFilesHandler) {
        await defaultFilesHandler({ ...externalContent, files: otherFiles })
      }
    })

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
      if (newImages.length === 0) return

      const updates = newImages
        .map((image) => editor.getShape(image.id))
        .filter(Boolean)
        .map((shape) => {
        const target = getDroppedImageTargetSize(editor, shape)
        if (!target) return null

        const currentW = Number(shape.props?.w ?? 0)
        const currentH = Number(shape.props?.h ?? 0)
        const w = target?.w ?? Number(shape.props?.w ?? 0)
        const h = target?.h ?? Number(shape.props?.h ?? 0)
        return {
          id: shape.id,
          type: 'image',
          x: shape.x + (currentW - w) / 2,
          y: shape.y + (currentH - h) / 2,
          props: { w, h },
        }
      })
        .filter(Boolean)

      editor.updateShapes(updates)
    }, { source: 'user', scope: 'document' })

    // Double-click on an image shape opens the lightbox. Hook into tldraw's
    // internal event bus — tldraw swallows native pointer events so DOM
    // dblclick doesn't reliably fire. ClickManager dispatches 'double_click'
    // via editor.on('event', ...). The canvas emits events with
    // target: 'canvas' (tldraw only sets target: 'shape' inside tool state
    // nodes, not on emitted events), so we hit-test the click point ourselves.
    const handleEditorEvent = (info) => {
      if (!info || info.type !== 'click' || info.name !== 'double_click') return
      if (info.phase !== 'down') return
      const screenPoint = info.point
      if (!screenPoint) return
      let shape = null
      if (info.target === 'shape' && info.shape) {
        shape = info.shape
      } else {
        const pagePoint = editor.screenToPage(screenPoint)
        shape = editor.getShapeAtPoint(pagePoint, { hitInside: true, hitLabels: false })
      }
      if (!shape || shape.type !== 'image') return
      resolveImageShapeUrl(editor, shape).then((url) => {
        if (!url) return
        // Reset tool so the user doesn't get stranded in crop mode when they
        // close the lightbox — tldraw transitions select → crop on image dbl-click.
        editor.setCurrentTool('select')
        openLightboxRef.current?.({ src: url, alt: shape.meta?.altText || '' })
      })
    }
    editor.on('event', handleEditorEvent)

    cleanupRef.current = () => {
      cleanupSave()
      cleanupDroppedImages()
      editor.registerExternalContentHandler('files', defaultFilesHandler)
      editor.off('event', handleEditorEvent)
    }
  }, [doSave])

  const updateReadonlyHoverAffordance = useCallback((event) => {
    if (!readOnlyRef.current) return

    const editor = editorRef.current
    if (!editor) return

    let cursor = ''
    let tooltip = ''

    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('a[href]')) {
      cursor = 'pointer'
    }

    const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY })
    const shape = editor.getShapeAtPoint(pagePoint, {
      hitInside: true,
      hitLabels: true,
      renderingOnly: true,
    })

    if (shape?.type === 'image') {
      tooltip = 'Double click to view'
    }

    const shapeUrl = typeof shape?.props?.url === 'string' ? shape.props.url.trim() : ''
    if (!cursor && shapeUrl) {
      cursor = 'pointer'
    }

    setHoverAffordance((prev) => (
      prev.cursor === cursor && prev.tooltip === tooltip
        ? prev
        : { cursor, tooltip }
    ))
  }, [])

  const handleMouseMove = (e) => {
    pointerRef.current = { clientX: e.clientX, clientY: e.clientY }
    updateGhost(e.clientX, e.clientY)
    updateReadonlyHoverAffordance(e)
  }

  const handleMouseLeave = () => {
    pointerRef.current = null
    setGhost(null)
    setHoverAffordance((prev) => (
      prev.cursor || prev.tooltip
        ? { cursor: '', tooltip: '' }
        : prev
    ))
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

  const handlePointerDownCapture = useCallback(() => {
    const editor = editorRef.current
    if (editor && !editor.getInstanceState().isFocused) {
      editor.focus()
    }
  }, [])

  const ghostPx = ghost && editorRef.current
    ? getNotePreviewSizePx(editorRef.current)
    : 0
  const ghostBg = ghost ? (STICKY_SWATCHES[ghost.color]?.bg || 'var(--s8-tl-lavender)') : null

  return (
    <div
      className={`tldraw-wrap${ghost ? ' sticky-placing' : ''}`}
      ref={wrapRef}
      title={hoverAffordance.tooltip || undefined}
      style={{
        opacity: boardFitting ? 0 : 1,
        transition: 'opacity 200ms ease-out',
        cursor: hoverAffordance.cursor || undefined,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onPointerDownCapture={handlePointerDownCapture}
      onWheelCapture={handleWheelCapture}
    >
      <Tldraw
        components={readOnly ? READONLY_TLDRAW_COMPONENTS : TLDRAW_COMPONENTS}
        onMount={handleMount}
        assets={assetStore}
        options={{ snapThreshold: 10 }}
        overrides={TLDRAW_UI_OVERRIDES}
        shapeUtils={FRAME_SHAPE_UTILS}
      >
        {!readOnly && <FjToolbar toolInfoRef={toolInfoRef} onOpenLightbox={openLightbox} />}
        {!readOnly && <ShapeInspector />}
        <FrameCornerStyles />
        <GeoCornerStyles />
        <ImageShapeStyles />
        <BrokenImageRetry />
        <ListStyles />
        <ShapeColorSync />
        {findQuery && <FindBar query={findQuery} onDismiss={onFindDismiss} boardId={boardId} findBoards={findBoards} onNavigateBoard={onNavigateBoard} findShapeIds={findShapeIds} />}
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
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />
      )}
    </div>
  )
}
