import { track, useEditor } from 'tldraw'

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
