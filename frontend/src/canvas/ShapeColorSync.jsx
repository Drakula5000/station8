import { useEffect } from 'react'
import { track, useEditor } from 'tldraw'

// Mirrors tldraw's reactive shape color/size onto data-attributes on the
// rendered shape DOM, so CSS in tldraw.css can theme shapes via Aurora tokens
// (the data-tl-color hook drives the color overrides). Custom geo fill colors
// stored in shape.meta are also pushed onto inline CSS variables here.
export const ShapeColorSync = track(function ShapeColorSync() {
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

      const fillColor = shape.type === 'geo' && typeof shape.meta?.fillColor === 'string' ? shape.meta.fillColor : null
      const fillOpacity = shape.type === 'geo' && typeof shape.meta?.fillOpacity === 'number' ? shape.meta.fillOpacity : 0

      if (fillColor && fillOpacity > 0) {
        el.setAttribute('data-geo-fill-custom', 'true')
        el.style.setProperty('--s8-geo-fill-color', fillColor)
        el.style.setProperty('--s8-geo-fill-opacity', String(fillOpacity))
      } else {
        el.removeAttribute('data-geo-fill-custom')
        el.style.removeProperty('--s8-geo-fill-color')
        el.style.removeProperty('--s8-geo-fill-opacity')
      }

      if (shape.meta?.strokeNone) {
        el.setAttribute('data-stroke-none', 'true')
      } else {
        el.removeAttribute('data-stroke-none')
      }

      // Magic / Auto color flag — when true, CSS in tldraw.css excepts this
      // shape from the upstream `data-tl-color='black'` text-color override
      // and lets tldraw's native auto-invert render the label per mode
      // (#1d1d1d in light, #f2f2f2 in dark). The stored props.color is
      // always 'black' for autoColor shapes; tldraw flips it natively, so
      // the shape live-binds to whatever mode the viewer is currently in.
      if (shape.meta?.autoColor) {
        el.setAttribute('data-auto-color', 'true')
      } else {
        el.removeAttribute('data-auto-color')
      }
    })
  })
  return null
})
