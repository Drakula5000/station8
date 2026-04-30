import { useState, useEffect, useRef, useCallback } from 'react'
import { track, useEditor } from 'tldraw'

// Walk a tldraw richText document and join all leaf `text` nodes. Used to
// extract searchable plain text from notes and text shapes.
function walkRichText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return node.text || ''
  return (node.content || []).map(walkRichText).join(' ')
}

// Best-effort extraction of human-readable text from any tldraw shape, so
// in-canvas find can match against rich text, plain text, image alt text,
// and frame names through one accessor.
function extractShapeText(shape) {
  if (!shape) return ''
  const type = shape.type
  const richText = shape.props?.richText
  if (richText) {
    const extracted = walkRichText(richText)
    if (extracted.trim()) return extracted
  }
  if (shape.props?.text) return shape.props.text
  if (type === 'image') return shape.meta?.altText || ''
  if (type === 'frame') return shape.props?.name || ''
  return ''
}

export const FindBar = track(function FindBar({ query, onDismiss, boardId, findBoards = [], onNavigateBoard, findShapeIds = [] }) {
  const editor = useEditor()
  const [matches, setMatches] = useState([])
  const [matchIndex, setMatchIndex] = useState(0)
  const retryRef = useRef(null)

  const boardIndex = findBoards.indexOf(boardId)
  const totalBoards = findBoards.length
  const hasPrevBoard = boardIndex > 0
  const hasNextBoard = boardIndex < totalBoards - 1

  const zoomToMatch = useCallback((editor, shapeId) => {
    const bounds = editor.getShapePageBounds(shapeId)
    if (!bounds || !(bounds.width > 0)) return
    // Re-measure viewport before zoomToBounds — instance_state.screenBounds
    // from loadStoreSnapshot is stale relative to today's DOM if the window
    // or sidebar was resized since load. Without this, matches centre off
    // to the right and content appears clipped. Mirrors doFit in TldrawCanvas.
    const container = editor.getContainer()
    if (container) editor.updateViewportScreenBounds(container)
    editor.zoomToBounds(bounds, { padding: 160, animation: { duration: 350 } })
    editor.selectNone()
  }, [])

  const buildMatches = useCallback((editor, q, preferredIds) => {
    const pageShapes = editor.getCurrentPageShapes()
    if (preferredIds && preferredIds.length > 0) {
      const byId = new Map(pageShapes.map(s => [s.id, s]))
      const ordered = preferredIds
        .filter(id => byId.has(id))
        .map(id => ({ shapeId: id }))
      if (ordered.length > 0) return ordered
    }
    return pageShapes
      .filter(s => extractShapeText(s).toLowerCase().includes(q))
      .map(s => ({ shapeId: s.id }))
  }, [])

  const findShapeIdsKey = findShapeIds.join('|')

  useEffect(() => {
    if (!editor || !query) return
    const q = query.toLowerCase()
    if (retryRef.current) clearTimeout(retryRef.current)

    const tryMatch = (attempt = 0) => {
      const found = buildMatches(editor, q, findShapeIds)
      if (found.length > 0) {
        setMatches(found)
        setMatchIndex(0)
        return
      }
      if (attempt < 30) {
        retryRef.current = setTimeout(() => tryMatch(attempt + 1), 100)
      } else {
        setMatches([])
        setMatchIndex(0)
      }
    }
    tryMatch()
    return () => { if (retryRef.current) clearTimeout(retryRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, query, buildMatches, findShapeIdsKey])

  useEffect(() => {
    if (!editor || matches.length === 0) return
    zoomToMatch(editor, matches[matchIndex].shapeId)
  }, [editor, matches, matchIndex, zoomToMatch])

  const currentShapeId = matches[matchIndex]?.shapeId || null
  const hasMatches = matches.length > 0

  // Reactive glow + dim. Runs after every render; track() re-runs on store
  // changes (camera tweens, shape mounts), letting us restamp once tldraw
  // finally renders the target DOM node.
  useEffect(() => {
    document.querySelectorAll('[data-find-glow="true"]').forEach(el => {
      if (el.getAttribute('data-shape-id') !== currentShapeId) {
        el.removeAttribute('data-find-glow')
      }
    })
    const wrap = document.querySelector('.tldraw-wrap')
    if (wrap) {
      if (hasMatches && currentShapeId) wrap.setAttribute('data-find-active', 'true')
      else wrap.removeAttribute('data-find-active')
    }
    if (!currentShapeId) return
    let rafId
    let attempts = 0
    const stamp = () => {
      const el = document.querySelector(`[data-shape-id="${currentShapeId}"]`)
      if (el) {
        if (!el.hasAttribute('data-find-glow')) el.setAttribute('data-find-glow', 'true')
        return
      }
      if (attempts++ < 60) rafId = requestAnimationFrame(stamp)
    }
    stamp()
    return () => { if (rafId) cancelAnimationFrame(rafId) }
  })

  useEffect(() => {
    return () => {
      document.querySelectorAll('[data-find-glow="true"]').forEach(el => el.removeAttribute('data-find-glow'))
      const wrap = document.querySelector('.tldraw-wrap')
      if (wrap) wrap.removeAttribute('data-find-active')
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const goNext = () => {
    if (matches.length > 1) {
      setMatchIndex((matchIndex + 1) % matches.length)
    } else if (hasNextBoard) {
      onNavigateBoard(findBoards[boardIndex + 1])
    }
  }

  const goPrev = () => {
    if (matches.length > 1) {
      setMatchIndex((matchIndex - 1 + matches.length) % matches.length)
    } else if (hasPrevBoard) {
      onNavigateBoard(findBoards[boardIndex - 1])
    }
  }

  const handleClose = () => onDismiss()

  const shapeCounter = matches.length === 0 ? '0 of 0' : `${matchIndex + 1} of ${matches.length}`
  const boardCounter = totalBoards > 1 ? ` · board ${boardIndex + 1}/${totalBoards}` : ''
  const counter = shapeCounter + boardCounter

  const prevDisabled = matches.length <= 1 && !hasPrevBoard
  const nextDisabled = matches.length <= 1 && !hasNextBoard

  let overlayStyle = null
  let overlayLabel = shapeCounter
  if (currentShapeId && editor) {
    const bounds = editor.getShapePageBounds(currentShapeId)
    if (bounds) {
      const tl = editor.pageToScreen({ x: bounds.minX, y: bounds.minY })
      const br = editor.pageToScreen({ x: bounds.maxX, y: bounds.maxY })
      overlayStyle = {
        left: `${tl.x}px`,
        top: `${tl.y}px`,
        width: `${br.x - tl.x}px`,
        height: `${br.y - tl.y}px`,
      }
    }
  }

  return (
    <>
      <style>{`
        /* Top-center find bar, glass style matching the pill */
        .find-bar {
          position: fixed;
          top: 0.875rem;
          left: 50%;
          transform: translateX(-50%);
          z-index: 520;
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.375rem 0.5rem 0.375rem 0.875rem;
          background: color-mix(in srgb, var(--s8-bg) 80%, transparent);
          backdrop-filter: blur(1.25rem) saturate(1.2);
          -webkit-backdrop-filter: blur(1.25rem) saturate(1.2);
          color: var(--s8-text);
          border: 0.0625rem solid var(--s8-accent-border);
          box-shadow: var(--s8-shadow-pill);
          border-radius: 62.4375rem;
          font-size: 0.75rem;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          letter-spacing: 0.01em;
          white-space: nowrap;
          pointer-events: all;
        }
        .find-bar-label {
          font-size: 0.625rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--s8-text-mid);
          font-weight: 600;
        }
        .find-bar-query {
          font-family: 'Space Mono', monospace;
          font-size: 0.75rem;
          color: var(--s8-text);
          max-width: 11.25rem;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .find-bar-counter {
          font-variant-numeric: tabular-nums;
          opacity: 0.7;
          padding: 0 0.375rem;
          border-left: 0.0625rem solid var(--s8-accent-border);
          border-right: 0.0625rem solid var(--s8-accent-border);
        }
        .find-bar-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--s8-text);
          padding: 0.25rem 0.5rem;
          border-radius: 62.4375rem;
          font-size: 0.8125rem;
          line-height: 1;
          transition: background 0.12s, color 0.12s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.5rem;
          height: 1.5rem;
        }
        .find-bar-btn:hover:not(:disabled) {
          background: var(--s8-accent-dim);
          color: var(--s8-accent);
        }
        .find-bar-btn.find-bar-close {
          background: var(--s8-accent);
          color: var(--s8-on-accent);
          margin-left: 0.125rem;
        }
        .find-bar-btn.find-bar-close:hover {
          background: color-mix(in srgb, var(--s8-accent) 85%, var(--s8-on-accent));
          color: var(--s8-on-accent);
        }
        .find-bar-btn:disabled {
          opacity: 0.3;
          cursor: default;
        }

        /* Dim all non-matched shapes when a find is active (match kept bright via data-find-glow) */
        .tldraw-wrap [data-shape-id] {
          transition: opacity 0.25s ease, filter 0.25s ease;
        }
        .tldraw-wrap[data-find-active="true"] [data-shape-id]:not([data-find-glow="true"]) {
          opacity: 0.2;
          filter: saturate(0.45);
        }

        /* Overlay marker — lives in fixed-position layer above canvas, no clipping */
        .find-overlay {
          position: fixed;
          z-index: 510;
          pointer-events: none;
          border: 0.0938rem solid var(--s8-accent);
          border-radius: 0.1875rem;
          box-shadow:
            0 0 0 0.25rem color-mix(in srgb, var(--s8-accent) 12%, transparent),
            0 0 1.75rem 0.25rem color-mix(in srgb, var(--s8-accent) 35%, transparent);
        }
        .find-overlay-label {
          position: absolute;
          top: -0.6875rem;
          left: 0.625rem;
          padding: 0.125rem 0.5rem;
          background: var(--s8-accent);
          color: var(--s8-on-accent);
          font-family: 'Inter', -apple-system, sans-serif;
          font-size: 0.625rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border-radius: 62.4375rem;
          white-space: nowrap;
          box-shadow: var(--s8-shadow-pill);
          font-variant-numeric: tabular-nums;
        }
      `}</style>

      {overlayStyle && (
        <div className="find-overlay" style={overlayStyle}>
          <span className="find-overlay-label">{overlayLabel}</span>
        </div>
      )}

      <div className="find-bar">
        <span className="find-bar-label">Find</span>
        <span className="find-bar-query">{query}</span>
        <span className="find-bar-counter">{counter}</span>
        <button
          className="find-bar-btn"
          onClick={goPrev}
          disabled={prevDisabled}
          title="Previous match"
          type="button"
        >↑</button>
        <button
          className="find-bar-btn"
          onClick={goNext}
          disabled={nextDisabled}
          title="Next match"
          type="button"
        >↓</button>
        <button
          className="find-bar-btn find-bar-close"
          onClick={handleClose}
          title="Clear find (Esc)"
          type="button"
        >✕</button>
      </div>
    </>
  )
})
