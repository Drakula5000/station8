import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Suppress third-party console noise
const _warn = console.warn.bind(console)
console.warn = (...args) => {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  if (msg.includes('willReadFrequently')) return
  _warn(...args)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
