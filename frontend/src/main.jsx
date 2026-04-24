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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
