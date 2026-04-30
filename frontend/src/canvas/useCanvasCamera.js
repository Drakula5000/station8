import { useCallback, useState } from 'react'

// Single chokepoint for canvas viewport zoom. Every caller must go through
// this hook — the load-bearing reason is that `editor.zoomToBounds` reads
// `instance_state.screenBounds` from the store, and `loadStoreSnapshot`
// replaces that record with whatever screenBounds were captured when the
// board was last saved. If today's window/sidebar is a different size, the
// centering math sees the stale value and content lands shifted toward the
// top-left. The fix is to re-measure the DOM right before each zoom; the
// hook owns that step so call-sites cannot forget it.

function remeasureViewport(editor) {
  const container = editor.getContainer()
  if (container) editor.updateViewportScreenBounds(container)
}

// Page-space bounds of everything a user can see: every frame's own rect plus
// every shape NOT inside a frame. Frames clip their children visually, so the
// frame bounds already cover anything inside; nested shapes are intentionally
// skipped because their stored w/h can exceed the frame (e.g. text shapes
// with huge `props.w`) and would pull the fit box past the last visible
// content.
export function getVisibleContentBounds(editor) {
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

// Poll until visible-content bounds stabilise across two consecutive reads,
// then zoom-fit. Stability matters because tldraw's shape mounting is async
// after `loadStoreSnapshot` — the bounds grow as more shapes mount, and
// firing a fit against an early partial bounds box puts the camera on the
// wrong region. Caps at 40 attempts (~4s); falls back to whatever bounds
// resolved last so an empty-board case still lands on (0,0,0,0) safely.
function fitBoardAfterOpen(editor, onComplete) {
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
    remeasureViewport(editor)
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
      finish()
    }
  }

  window.setTimeout(tryFit, 150)
}

// Accept either an editor instance (FindBar uses `useEditor()`) or a
// useRef-style ref (TldrawCanvas only has the editor in handleMount).
function resolveEditor(editorOrRef) {
  if (!editorOrRef) return null
  if (typeof editorOrRef.getContainer === 'function') return editorOrRef
  if ('current' in editorOrRef) return editorOrRef.current
  return null
}

export function useCanvasCamera(editorOrRef) {
  // Default true so consumers using `isFitting` to gate canvas opacity stay
  // hidden until the first fitToContent resolves. Components that never call
  // fitToContent (FindBar) can ignore the value.
  const [isFitting, setFitting] = useState(true)

  const fitToContent = useCallback(() => {
    const editor = resolveEditor(editorOrRef)
    if (!editor) return
    setFitting(true)
    fitBoardAfterOpen(editor, () => setFitting(false))
  }, [editorOrRef])

  const zoomToShapeBounds = useCallback((shapeId, opts) => {
    const editor = resolveEditor(editorOrRef)
    if (!editor) return false
    const bounds = editor.getShapePageBounds(shapeId)
    if (!bounds) return false
    const w = bounds.width ?? bounds.w
    const h = bounds.height ?? bounds.h
    if (!(w > 0) || !(h > 0)) return false
    remeasureViewport(editor)
    editor.zoomToBounds(bounds, opts)
    return true
  }, [editorOrRef])

  return { fitToContent, zoomToShapeBounds, isFitting }
}
