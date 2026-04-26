import { useEffect } from 'react'
import { track, useEditor } from 'tldraw'

// Retries failed image loads with exponential backoff. Useful when the
// Supabase signed URL expires mid-session or the network briefly drops —
// without this the broken-image placeholder sticks until manual reload.
export const BrokenImageRetry = track(function BrokenImageRetry() {
  const editor = useEditor()
  const shapes = editor.getCurrentPageShapes().filter(s => s.type === 'image')

  useEffect(() => {
    if (shapes.length === 0) return
    const timers = []

    shapes.forEach(shape => {
      const el = document.querySelector(`[data-shape-id="${shape.id}"] img`)
      if (!el || el.complete && el.naturalWidth > 0) return
      const retry = (attempt = 0) => {
        if (!el || el.naturalWidth > 0) return
        const delay = Math.min(1000 * Math.pow(2, attempt), 16000)
        const t = setTimeout(() => {
          if (el.naturalWidth > 0) return
          const src = el.src
          el.src = ''
          requestAnimationFrame(() => { el.src = src })
          if (attempt < 5) retry(attempt + 1)
        }, delay)
        timers.push(t)
      }
      if (el.complete && el.naturalWidth === 0) {
        retry(0)
      } else {
        el.addEventListener('error', () => retry(0), { once: true })
      }
    })

    return () => timers.forEach(clearTimeout)
  })

  return null
})
