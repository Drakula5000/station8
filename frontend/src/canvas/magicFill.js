// Export-time SVG patcher.
//
// On canvas, every Aurora override (note backgrounds, frame colours, custom
// geo fills, text-on-shape colours) is applied via CSS that hooks the
// data-tl-color / data-shape-type / data-geo-fill-custom attributes
// ShapeColorSync stamps on the rendered DOM. None of that CSS reaches the
// SVG that tldraw's toSvg path produces — that SVG is built straight from
// shape.props using tldraw's built-in colour theme, so the export silently
// diverges from what the user actually sees (lavender note exports as
// tldraw's lighter lavender, magic black note exports as yellow, custom
// pink geo fill exports as default black, etc.).
//
// patchSvgExports() walks the exported SVG and re-applies our overrides at
// the SVG-attribute level (fills, strokes, foreignObject text colour). The
// only thing it depends on is that each shape is wrapped in a single
// <g transform="matrix(a,b,c,d,x,y)"> where (x,y) matches shape.x/shape.y —
// which tldraw has done as long as we've used it. Order of operations
// inside each <g> is the same as tldraw renders it on canvas, so the first
// non-`fill="none"` element is the body; the foreignObject is the rich
// text label.

// ============================================================
//  Magic auto-fill (used by the FILL row's Auto chip)
// ============================================================

export const MAGIC_FILL = '__auto__'

export function resolveFillColor(fillColor, isDark) {
  if (fillColor === MAGIC_FILL) return isDark ? '#FFFFFF' : '#000000'
  return resolveCssVar(fillColor)
}

export function hasCustomFill(shape) {
  return (
    shape?.type === 'geo' &&
    typeof shape?.meta?.fillColor === 'string' &&
    Number(shape?.meta?.fillOpacity) > 0
  )
}

// ============================================================
//  Aurora colour resolution
// ============================================================

// Resolves a `var(--s8-…)` string against the live :root vars so the value
// matches the current canvas mode. Plain hex / rgb strings pass through.
function resolveCssVar(value) {
  if (typeof value !== 'string' || !value.startsWith('var(')) return value
  const m = value.match(/var\(\s*(--[^,)\s]+)/)
  if (!m) return value
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim()
  return resolved || value
}

// tldraw colour name → Aurora swatch CSS var. Mirrors the override map in
// tldraw.css (note backgrounds + geo/text/frame colour rules). yellow and
// green are legacy aliases that map onto lavender / teal so the picker
// remains consistent with the design system.
const COLOR_TO_VAR = {
  'light-violet': '--s8-tl-lavender',
  'yellow':        '--s8-tl-lavender',
  'violet':        '--s8-tl-violet',
  'light-red':     '--s8-tl-pink',
  'red':           '--s8-tl-pink-strong',
  'light-blue':    '--s8-tl-blue',
  'blue':          '--s8-tl-blue',
  'light-green':   '--s8-tl-teal',
  'green':         '--s8-tl-teal',
  'orange':        '--s8-tl-orange',
  'grey':          '--s8-tl-grey',
  'black':         '--s8-tl-black',
  'white':         '--s8-tl-white',
}

function auroraHex(colorName) {
  const v = COLOR_TO_VAR[colorName]
  if (!v) return null
  return resolveCssVar(`var(${v})`)
}

// Notes contrast text against the swatch bg, not the canvas. Matches the
// per-swatch buckets documented in tldraw.css's note-text section.
const NOTE_LIGHT_BG_COLORS = new Set([
  'light-violet', 'yellow', 'light-red', 'light-blue', 'blue',
  'light-green', 'green', 'orange', 'white',
])

function noteTextHex(colorName) {
  return NOTE_LIGHT_BG_COLORS.has(colorName) ? '#1d1d1d' : '#FFFFFF'
}

// ============================================================
//  SVG patching
// ============================================================

const MATRIX_RE = /matrix\(\s*[\d.+-]+\s*,\s*[\d.+-]+\s*,\s*[\d.+-]+\s*,\s*[\d.+-]+\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)/

function transformKey(g) {
  const m = (g.getAttribute('transform') || '').match(MATRIX_RE)
  if (!m) return null
  return `${Math.round(parseFloat(m[1]))},${Math.round(parseFloat(m[2]))}`
}

// Replace the `color:` declaration on every styled inner element of a
// shape's foreignObject. Skips `caret-color:`, `column-rule-color:`, etc.
// because the boundary token (`^` or `;`) won't appear before those.
function setForeignObjectTextColor(g, hex) {
  for (const div of g.querySelectorAll('foreignObject [style*="color"]')) {
    const s = div.getAttribute('style') || ''
    div.setAttribute('style', s.replace(/(^|;\s*)color:\s*[^;"]+/g, `$1color: ${hex}`))
  }
}

// Returns the first child element of the shape group whose `fill` attr is
// a real colour (not "none" / missing). That's tldraw's convention for
// the body: filled element first, stroke element after with fill="none".
// Notes have two: a shadow rect + the body rect. We treat the LAST filled
// element as the body so we don't repaint the shadow with a strong opacity.
function paintBodyFills(g, hex, opacity) {
  const filled = []
  for (const el of g.querySelectorAll(':scope > rect, :scope > path')) {
    const f = el.getAttribute('fill')
    if (f && f !== 'none') filled.push(el)
  }
  for (const el of filled) {
    el.setAttribute('fill', hex)
    if (opacity != null) el.setAttribute('fill-opacity', String(opacity))
  }
}

function paintFirstBody(g, hex, opacity) {
  for (const el of g.querySelectorAll(':scope > rect, :scope > path')) {
    const f = el.getAttribute('fill')
    if (f && f !== 'none') {
      el.setAttribute('fill', hex)
      if (opacity != null) el.setAttribute('fill-opacity', String(opacity))
      return
    }
  }
}

// ============================================================
//  Main entry: walks the SVG, applies every Aurora override
// ============================================================

export function patchSvgExports(svgString, editor, ids, isDark) {
  // Build shape lookup by transform-translation
  const shapeByXY = new Map()
  for (const id of ids) {
    const s = editor.getShape(id)
    if (!s) continue
    shapeByXY.set(`${Math.round(s.x)},${Math.round(s.y)}`, s)
  }
  if (shapeByXY.size === 0) return svgString

  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
  for (const g of Array.from(doc.documentElement.children)) {
    if (g.tagName.toLowerCase() !== 'g') continue
    const key = transformKey(g)
    if (!key) continue
    const shape = shapeByXY.get(key)
    if (!shape) continue

    if (shape.type === 'note') {
      patchNote(g, shape)
    } else if (shape.type === 'geo') {
      patchGeo(g, shape, isDark)
    }
  }
  return new XMLSerializer().serializeToString(doc)
}

function patchNote(g, shape) {
  // Magic notes (meta.autoColor) are already handled by StationNoteShapeUtil.toSvg —
  // it renders pure black/white directly via the toSvg override. Skip here.
  if (shape.meta?.autoColor) return
  const bg = auroraHex(shape.props.color)
  const text = noteTextHex(shape.props.color)
  if (bg) {
    // Re-paint BOTH the shadow rect and body rect so the note reads as a
    // single coloured block (tldraw paints both as the noteFill colour).
    paintBodyFills(g, bg, 1)
  }
  setForeignObjectTextColor(g, text)
}

function patchGeo(g, shape, isDark) {
  // Custom fill from the Fill row (or magic) — overrides tldraw's default fill.
  if (hasCustomFill(shape)) {
    const color = resolveFillColor(shape.meta.fillColor, isDark)
    const opacity = Number(shape.meta.fillOpacity)
    paintFirstBody(g, color, opacity)
    // Magic fills additionally swap text colour to contrast — black/white inverts.
    if (shape.meta.fillColor === MAGIC_FILL) {
      setForeignObjectTextColor(g, isDark ? '#000000' : '#FFFFFF')
    }
    return
  }
  // No custom fill but might still have a non-default colour whose text override
  // we apply via CSS on canvas. The export uses tldraw's native labelColor which
  // is fine for most colours — only `black` text on default-fill (#e8e8e8 light
  // grey) is identical to the body fill in dark mode. We rely on tldraw native
  // here; if it becomes a problem we'd extend with per-colour text mapping.
}

// Back-compat: keep the old export name pointing at the comprehensive impl.
export const patchSvgFills = patchSvgExports
