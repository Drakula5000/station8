import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// tldraw internals create 2D canvas contexts without the willReadFrequently
// hint and then do getImageData readbacks (ImageAlphaCache, image export, etc).
// Chrome logs a warning for each. Patch the prototype so every 2D context
// this page creates gets willReadFrequently: true — silences the warning at
// its source without touching tldraw internals.
const _getContext = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function (type, attrs) {
  if (type === '2d') {
    attrs = { ...(attrs || {}), willReadFrequently: true }
  }
  return _getContext.call(this, type, attrs)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
