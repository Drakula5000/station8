// Shared helpers for the "magic" auto-fill feature on geo shapes.
//
// A magic fill is one whose colour flips with the canvas mode — black on
// light, white on dark — matching the magic-stroke / magic-text / magic-note
// pattern. The sentinel below is stored in `shape.meta.fillColor` instead of
// a real hex; everything else (opacity, the DefaultFillStyle='solid' set, the
// data-geo-fill-custom DOM attribute) is shared with normal custom fills.

export const MAGIC_FILL = '__auto__'

// The Fill row stores swatch values as CSS `var(--s8-tl-*)` references so the
// on-canvas <style> cascade can swap them per mode. SVG `fill` attributes
// don't resolve var() — the literal string is treated as invalid colour and
// the path falls back to black. Resolve to the live computed value before
// stamping into the exported SVG.
function resolveCssVar(value) {
  if (typeof value !== 'string' || !value.startsWith('var(')) return value
  const m = value.match(/var\(\s*(--[^,)\s]+)/)
  if (!m) return value
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()
  return resolved || value
}

export function resolveFillColor(fillColor, isDark) {
  if (fillColor === MAGIC_FILL) return isDark ? '#FFFFFF' : '#000000'
  return resolveCssVar(fillColor)
}

// True when a shape carries a custom fill we own (the on-canvas CSS or the
// export-time SVG patch should kick in). Geo-only today; widen if any
// other shape type adopts the same meta convention.
export function hasCustomFill(shape) {
  return (
    shape?.type === 'geo' &&
    typeof shape?.meta?.fillColor === 'string' &&
    Number(shape?.meta?.fillOpacity) > 0
  )
}

// Pure magic fills swap to high-contrast text. For non-magic explicit colours
// we leave text alone — those are usually pastels and tldraw's own labelColor
// works fine.
function magicTextColor(fillColor, isDark) {
  if (fillColor !== MAGIC_FILL) return null
  return isDark ? '#000000' : '#FFFFFF'
}

// Walks the SVG string and substitutes custom fills (and, for magic fills,
// the contrasting text colour) onto each shape's already-rendered <g>. Used
// at export time because:
//   - tldraw's GeoShapeUtil.toSvg reads only shape.props (not meta), so the
//     Fill row's custom hex colours are silently dropped in exports.
//   - magic fills additionally need text recolouring so dark-text-on-dark-
//     fill (or light-on-light) doesn't disappear.
// Matches shapes by translation in their transform matrix: tldraw wraps each
// shape in <g transform="matrix(a,b,c,d,e,f)"> where (e,f) == shape.x,
// shape.y. Stable enough for any flat (non-rotated, non-scaled) layout.
export function patchSvgFills(svgString, editor, ids, isDark) {
  const fillsByXY = new Map() // "x,y" -> { color, opacity, textColor }
  for (const id of ids) {
    const shape = editor.getShape(id)
    if (!hasCustomFill(shape)) continue
    fillsByXY.set(`${Math.round(shape.x)},${Math.round(shape.y)}`, {
      color: resolveFillColor(shape.meta.fillColor, isDark),
      opacity: Number(shape.meta.fillOpacity),
      textColor: magicTextColor(shape.meta.fillColor, isDark),
    })
  }
  if (fillsByXY.size === 0) return svgString

  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
  const root = doc.documentElement
  const matrixRe = /matrix\(\s*[\d.+-]+\s*,\s*[\d.+-]+\s*,\s*[\d.+-]+\s*,\s*[\d.+-]+\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)/
  for (const g of Array.from(root.children)) {
    if (g.tagName.toLowerCase() !== 'g') continue
    const m = (g.getAttribute('transform') || '').match(matrixRe)
    if (!m) continue
    const key = `${Math.round(parseFloat(m[1]))},${Math.round(parseFloat(m[2]))}`
    const fill = fillsByXY.get(key)
    if (!fill) continue
    // First path child with a real fill is the body (the next path is the stroke with fill="none").
    for (const path of g.querySelectorAll(':scope > path')) {
      const f = path.getAttribute('fill')
      if (f && f !== 'none') {
        path.setAttribute('fill', fill.color)
        path.setAttribute('fill-opacity', String(fill.opacity))
        break
      }
    }
    if (fill.textColor) {
      // foreignObject text colour lives in the inner div's inline style.
      for (const div of g.querySelectorAll('foreignObject [style*="color"]')) {
        const s = div.getAttribute('style') || ''
        div.setAttribute('style', s.replace(/(^|;\s*)color:\s*[^;"]+/g, `$1color: ${fill.textColor}`))
      }
    }
  }
  return new XMLSerializer().serializeToString(doc)
}
