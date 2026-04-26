import { track, useEditor } from 'tldraw'
import { AURORA_SWATCHES } from '../colors'

// Reactive components that inject per-shape CSS based on tldraw shape state.
// React 19 hoists <style> tags into <head> automatically, so each component
// keeps its rules scoped by [data-shape-id="..."] selectors.

export const FrameCornerStyles = track(function FrameCornerStyles() {
  const editor = useEditor()
  const frames = editor.getCurrentPageShapes().filter(
    s => s.type === 'frame' && Number(s.meta?.cornerRadius) > 0
  )
  if (frames.length === 0) return null
  const css = frames.map(f => {
    const rx = Number(f.meta.cornerRadius)
    const id = f.id
    return [
      `[data-shape-id="${id}"] .tl-frame__body { rx: ${rx}px }`,
      `[data-shape-id="${id}"] .tl-frame-heading,`,
      `[data-shape-id="${id}"] .tl-frame-heading-hit-area { border-radius: ${rx * 12 / 32}px }`,
    ].join('\n')
  }).join('\n')
  return <style>{css}</style>
})

// Geo rectangles get 4 corner-radius options matching frames. tldraw renders
// the rect body as a single SVG <path> following a sharp rectangle, so neither
// `rx` nor a CSS clip will produce a clean rounded border — clipping at the
// rounded edge cuts the corner stroke down to a thin sliver because the path
// itself still draws a 90° corner. Instead:
//   1. Clip the SVG container to the rounded rect (hides the fill that would
//      otherwise show in the corner cutouts).
//   2. Hide tldraw's stroke (transparent), since it can't follow the rounding.
//   3. Redraw the stroke as a CSS outline on the wrapper, which honours
//      border-radius natively and renders a uniform-thickness rounded border.
//
// Skip when dash !== 'solid' — sketchy/dashed/dotted strokes are part of the
// path, can't be replicated cleanly by an outline, and look weird with rounded
// corners anyway. The Inspector auto-flips dash to 'solid' when the user picks
// any non-zero radius, so this only excludes shapes the user deliberately
// keeps sketchy.
const RECT_CLASS_GEOS = new Set(['rectangle', 'x-box', 'check-box'])

// Match tldraw's STROKE_SIZES so the redrawn outline visually matches what the
// stroke would have been. Size=s is bumped down to 1 to match the
// `data-s8-size='s'` weight override in tldraw.css.
const STROKE_WIDTH_BY_SIZE = { s: 1, m: 3.5, l: 5, xl: 10 }

const TL_COLOR_TO_CSS = {
  ...Object.fromEntries(AURORA_SWATCHES.map((s) => [s.tl, s.bg])),
  // Aliases for tldraw color names not in the Aurora swatch list.
  yellow: 'var(--s8-tl-lavender)',
  green:  'var(--s8-tl-teal)',
  // Black-on-canvas in dark mode reads as #1d1d1d (matches the text-label
  // override in tldraw.css), not the literal #000 that disappears.
  black:  'var(--s8-tl-text-on-light)',
}

export const GeoCornerStyles = track(function GeoCornerStyles() {
  const editor = useEditor()
  const rects = editor.getCurrentPageShapes().filter((s) => (
    s.type === 'geo'
    && RECT_CLASS_GEOS.has(s.props?.geo)
    && s.props?.dash === 'solid'
    && Number(s.meta?.cornerRadius ?? 0) > 0
  ))
  if (rects.length === 0) return null

  const css = rects.map((shape) => {
    const id = shape.id
    const rx = Number(shape.meta.cornerRadius)
    const baseSw = STROKE_WIDTH_BY_SIZE[shape.props.size] ?? 3.5
    const sw = baseSw * (Number(shape.props.scale) || 1)
    const color = TL_COLOR_TO_CSS[shape.props.color] || 'currentColor'
    return [
      // Clip the fill (and the now-hidden stroke path) to the rounded rect.
      `[data-shape-id="${id}"] > .tl-svg-container { border-radius: ${rx}px; overflow: hidden; }`,
      // Hide tldraw's stroke — it can't follow the rounding.
      `[data-shape-id="${id}"] > .tl-svg-container [stroke] { stroke: transparent !important; }`,
      // Redraw the stroke as an outline on the wrapper. outline-offset:
      // -sw/2 centres it on the wrapper edge so the rounded border lands
      // exactly where tldraw's stroke would have. Suppressed when the user
      // toggles Border → Off (data-stroke-none="true").
      `[data-shape-id="${id}"] { border-radius: ${rx}px; }`,
      `[data-shape-id="${id}"]:not([data-stroke-none="true"]) {`,
      `  outline: ${sw}px solid ${color};`,
      `  outline-offset: -${sw / 2}px;`,
      `}`,
    ].join('\n')
  }).join('\n')

  return <style>{css}</style>
})

export const ImageShapeStyles = track(function ImageShapeStyles() {
  const editor = useEditor()
  const images = editor.getCurrentPageShapes().filter((s) => {
    if (s.type !== 'image') return false
    const hasExplicitCorners = Object.prototype.hasOwnProperty.call(s.meta ?? {}, 'imageCornerRadius')
    return hasExplicitCorners || Number(s.meta?.imageBorderWidth ?? 0) > 0
  })
  if (images.length === 0) return null

  const css = images.map((image) => {
    const id = image.id
    const radius = image.props.crop?.isCircle ? '50%' : `${Number(image.meta?.imageCornerRadius ?? 0)}px`
    const borderWidth = Number(image.meta?.imageBorderWidth ?? 0)
    const borderColor = image.meta?.imageBorderColor || 'var(--s8-accent)'
    const outlineStyle = borderWidth > 0
      ? `outline: ${borderWidth}px solid ${borderColor}; outline-offset: 0; will-change: transform;`
      : 'outline: none;'

    return [
      `[data-shape-id="${id}"] .tl-html-container { position: relative; border-radius: ${radius}; overflow: hidden; ${outlineStyle} }`,
      `[data-shape-id="${id}"] .tl-image-container,`,
      `[data-shape-id="${id}"] .tl-image { border-radius: inherit; }`,
    ].join('\n')
  }).join('\n')

  return <style>{css}</style>
})

export const ListStyles = track(function ListStyles() {
  const editor = useEditor()
  const shapesWithLists = editor.getCurrentPageShapes().filter((s) => {
    return (s.type === 'note' || s.type === 'text') && s.meta?.listStyle
  })
  if (shapesWithLists.length === 0) return null

  const css = shapesWithLists.map((shape) => {
    const id = shape.id
    const listStyle = shape.meta.listStyle
    if (listStyle === 'roman') {
      // Roman: I, II, III → a, b, c → i, ii, iii → 1, 2, 3
      return [
        `[data-shape-id="${id}"] ol { list-style-type: upper-roman !important; }`,
        `[data-shape-id="${id}"] ol ol { list-style-type: lower-alpha !important; }`,
        `[data-shape-id="${id}"] ol ol ol { list-style-type: lower-roman !important; }`,
        `[data-shape-id="${id}"] ol ol ol ol { list-style-type: decimal !important; }`,
      ].join('\n')
    }
    return ''
  }).filter(Boolean).join('\n')

  return css ? <style>{css}</style> : null
})
