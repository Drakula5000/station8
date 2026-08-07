import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// tldraw internals create 2D canvas contexts without the willReadFrequently
// hint and then do getImageData readbacks (ImageAlphaCache, image export, etc).
// Chrome logs a warning for each. Patch both HTMLCanvasElement and
// OffscreenCanvas prototypes so every 2D context gets willReadFrequently:true.
function patchGetContext(Klass) {
  if (!Klass?.prototype?.getContext) return
  const original = Klass.prototype.getContext
  Klass.prototype.getContext = function (type, attrs) {
    if (type === '2d') {
      attrs = { ...(attrs || {}), willReadFrequently: true }
    }
    return original.call(this, type, attrs)
  }
}
patchGetContext(typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement : null)
patchGetContext(typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null)

// Station's import/error notices sit over the canvas toolbar. Keep the import
// running, but always give the owner a way to dismiss the notice itself. This
// enhancer is deliberately DOM-level so it also covers notices emitted while
// React is busy updating OCR / Office conversion progress.
function installDismissibleStationNotices() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return

  const enhance = (root = document) => {
    const notices = root.querySelectorAll?.('.error-toast, .pdf-drop-progress-toast') || []
    for (const notice of notices) {
      if (notice.dataset.s8Dismissible === 'true') continue
      notice.dataset.s8Dismissible = 'true'
      notice.style.position = notice.style.position || 'fixed'
      notice.style.paddingRight = '2.35rem'

      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = '×'
      close.setAttribute('aria-label', 'Dismiss notice')
      close.title = 'Dismiss'
      close.style.position = 'absolute'
      close.style.right = '0.55rem'
      close.style.top = '50%'
      close.style.transform = 'translateY(-50%)'
      close.style.width = '1.35rem'
      close.style.height = '1.35rem'
      close.style.border = '0'
      close.style.borderRadius = '0.25rem'
      close.style.background = 'transparent'
      close.style.color = 'inherit'
      close.style.font = 'inherit'
      close.style.fontSize = '1rem'
      close.style.lineHeight = '1'
      close.style.cursor = 'pointer'
      close.style.opacity = '0.8'
      close.style.display = 'grid'
      close.style.placeItems = 'center'
      close.addEventListener('mouseenter', () => { close.style.opacity = '1' })
      close.addEventListener('mouseleave', () => { close.style.opacity = '0.8' })
      close.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        notice.style.display = 'none'
      })
      notice.appendChild(close)
    }
  }

  enhance()
  const observer = new MutationObserver(() => enhance())
  observer.observe(document.body, { childList: true, subtree: true })
}
installDismissibleStationNotices()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
