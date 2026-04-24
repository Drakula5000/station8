import { useCallback, useEffect, useRef, useState } from 'react'
import './ImageLightbox.css'

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const ZOOM_STEP = 0.25

export function ImageLightbox({ src, alt, onClose }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const draggingRef = useRef(null)
  const imgRef = useRef(null)

  const reset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  useEffect(() => { reset() }, [src, reset])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
      else if (e.key === '-' || e.key === '_') setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
      else if (e.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, reset])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = -e.deltaY * 0.003
    setZoom((z) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta * z))
      if (next <= MIN_ZOOM) setPan({ x: 0, y: 0 })
      return next
    })
  }, [])

  const handlePointerDown = (e) => {
    if (zoom <= MIN_ZOOM) return
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  const handlePointerMove = (e) => {
    const d = draggingRef.current
    if (!d) return
    setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) })
  }

  const handlePointerUp = (e) => {
    if (draggingRef.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    }
    draggingRef.current = null
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleDoubleClick = () => {
    if (zoom > MIN_ZOOM) reset()
    else setZoom(2)
  }

  return (
    <div
      className="s8-lightbox"
      onClick={handleBackdropClick}
      onWheel={handleWheel}
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image viewer'}
    >
      <button
        className="s8-lightbox-close"
        onClick={onClose}
        type="button"
        aria-label="Close"
      >✕</button>

      <div className="s8-lightbox-controls" onClick={(e) => e.stopPropagation()}>
        <button
          className="s8-lightbox-btn"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
          type="button"
          aria-label="Zoom out"
        >−</button>
        <button
          className="s8-lightbox-btn s8-lightbox-btn-reset"
          onClick={reset}
          type="button"
          aria-label="Reset zoom"
        >{Math.round(zoom * 100)}%</button>
        <button
          className="s8-lightbox-btn"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
          type="button"
          aria-label="Zoom in"
        >+</button>
      </div>

      <div
        className="s8-lightbox-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: zoom > MIN_ZOOM ? (draggingRef.current ? 'grabbing' : 'grab') : 'zoom-in' }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ''}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        />
      </div>
    </div>
  )
}
