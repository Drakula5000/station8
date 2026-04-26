import { useEffect, useRef, useState } from 'react'
import {
  track,
  useEditor,
  DefaultColorStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultHorizontalAlignStyle,
  DefaultDashStyle,
  ArrowShapeArrowheadStartStyle,
  ArrowShapeArrowheadEndStyle,
} from 'tldraw'
import { FjDraftIcon, FjDataIcon, FjAnalysisIcon, FjInsightIcon } from '../icons'
import { AURORA_SWATCHES as COLOR_SWATCHES } from '../colors'
import {
  SHAPES_WITH_STROKE_STYLE,
  SIZE_OPTIONS as SIZES,
  STROKE_STYLE_OPTIONS,
  RECT_CLASS_GEOS,
} from '../canvas/styleOptions'

const DEFAULT_FILL_OPACITY = 0.4

const FILL_OPACITY_OPTIONS = [
  { id: 0, label: 'Off', title: 'No fill' },
  { id: 0.2, label: '20', title: '20% fill' },
  { id: 0.4, label: '40', title: '40% fill' },
  { id: 0.6, label: '60', title: '60% fill' },
  { id: 0.8, label: '80', title: '80% fill' },
  { id: 1, label: '100', title: '100% fill' },
]

const FONTS = [
  { id: 'draw',  label: 'Draft',    Icon: FjDraftIcon },
  { id: 'mono',  label: 'Data',     Icon: FjDataIcon },
  { id: 'sans',  label: 'Analysis', Icon: FjAnalysisIcon },
  { id: 'serif', label: 'Insight',  Icon: FjInsightIcon },
]

// Mirrors tldraw's default text shape font sizes. Text shapes also support a
// per-shape scale multiplier, which lets us restore freeform numeric sizing.
const SIZE_TO_PX = {
  s: 18,
  m: 24,
  l: 36,
  xl: 44,
}

const ALIGNS = [
  { id: 'start',  label: '⟵', title: 'Left' },
  { id: 'middle', label: '↔',  title: 'Center' },
  { id: 'end',    label: '⟶', title: 'Right' },
]

const LIST_TYPES = [
  { id: 'none', label: '—', title: 'No list' },
  { id: 'bullet', label: '•', title: 'Bullet list' },
  { id: 'ordered', label: '1.', title: 'Numbered list' },
  { id: 'roman', label: 'I.', title: 'Roman numeral list' },
]

const CORNER_OPTIONS = [
  { id: 0,  cls: 'corner-swatch-0',  title: 'Sharp' },
  { id: 8,  cls: 'corner-swatch-8',  title: 'Soft' },
  { id: 16, cls: 'corner-swatch-16', title: 'Round' },
  { id: 32, cls: 'corner-swatch-32', title: 'Pill' },
]

// Arrow-tip pickers — value strings come straight from tldraw's
// arrowheadTypes enum (TLArrowShape). Glyphs render compactly inside the
// inspector; only the most common subset is exposed here to keep the row
// readable. To surface more options, append them to this list.
const ARROWHEAD_OPTIONS = [
  { id: 'none',     glyph: '—', title: 'None' },
  { id: 'arrow',    glyph: '➤', title: 'Arrow' },
  { id: 'triangle', glyph: '▶', title: 'Triangle' },
  { id: 'dot',      glyph: '●', title: 'Dot' },
  { id: 'diamond',  glyph: '◆', title: 'Diamond' },
  { id: 'square',   glyph: '■', title: 'Square' },
  { id: 'bar',      glyph: '|', title: 'Bar' },
]

const STROKE_TOGGLE_OPTIONS = [
  { id: 'on',  label: 'On',  title: 'Border on' },
  { id: 'off', label: 'Off', title: 'No border' },
]

const IMAGE_BORDER_OPTIONS = [
  { id: 0, label: 'Off', title: 'No border' },
  { id: 1, label: 'Thin', title: 'Thin border' },
  { id: 4, label: 'Bold', title: 'Bold border' },
]

const INSPECTOR_SCREEN_MARGIN = 16
const INSPECTOR_GAP = 14
const MIN_INSPECTOR_SCALE = 0.62
const MAX_INSPECTOR_SCALE = 1

// Which control rows apply to which shape types.
// Keep conservative — show a control only when ALL selected shapes support it.
const SHAPES_WITH_COLOR   = new Set(['note', 'geo', 'text', 'arrow', 'line', 'draw', 'frame', 'highlight'])
const SHAPES_WITH_FILL    = new Set(['geo'])
const SHAPES_WITH_TEXT    = new Set(['note', 'geo', 'text', 'arrow'])
const SHAPES_WITH_SIZE    = new Set(['note', 'geo', 'text', 'arrow', 'line', 'draw'])
const SHAPES_WITH_ALIGN   = new Set(['note', 'geo', 'text'])
const SHAPES_WITH_CORNERS = new Set(['frame'])
const SHAPES_WITH_IMAGE_STYLING = new Set(['image'])
const SHAPES_WITH_FREEFORM_TEXT_SIZE = new Set(['text'])
const SHAPES_WITH_LISTS = new Set(['note', 'text'])
const SHAPES_WITH_ARROWHEADS = new Set(['arrow'])
// Shapes where "no border" is meaningful: a geo rectangle with a fill can
// still read as a card without an outline. Frames always have a border (it's
// how they work), so they're excluded. For arrows/lines/draws the stroke
// IS the visual, so the toggle would just hide the shape — exclude them.
const SHAPES_WITH_STROKE_TOGGLE = new Set(['geo'])
// Rectangle-class geos can take a real corner radius (rendered via CSS
// border-radius + overflow:hidden on the SVG container, see GeoCornerStyles).
// Other geo subtypes (diamond, triangle, ellipse, etc.) skip the row.
// Color-row context decides whether the per-mode black/white disable rule
// fires. Shapes that frequently sit on top of filled shapes (text, draw,
// highlight) need every color in every mode — black text on a white sticky
// is meaningful even on a dark canvas. Frames/geos/lines/arrows/notes go
// through the strict 'stroke' context where black-in-dark / white-in-light
// are dimmed + struck through (see canvas.css).
const SHAPES_WITH_PERMISSIVE_COLOR = new Set(['text', 'draw', 'highlight'])
// Auto / Magic swatch is only meaningful for shapes whose color renders
// via tldraw's `solid` palette (which natively auto-inverts black across
// modes). Highlights use `highlightSrgb` instead and would render any
// color name as a fluorescent variant — black-highlight = yellow, so
// "auto" can't actually flip with mode. Restrict the swatch to text/draw.
const SHAPES_WITH_AUTO_COLOR = new Set(['text', 'draw'])

function allShapesMatch(shapes, set) {
  return shapes.length > 0 && shapes.every((s) => set.has(s.type))
}

function allRectangleGeoShapes(shapes) {
  return shapes.length > 0 && shapes.every(
    (shape) => shape.type === 'geo' && RECT_CLASS_GEOS.has(shape.props?.geo)
  )
}

// Pluck a shared style value across a selection. Returns undefined when
// the shapes disagree (so no swatch shows active).
function sharedStyle(editor, styleProp) {
  const shared = editor.getSharedStyles()
  const entry = shared.get(styleProp)
  if (!entry || entry.type === 'mixed') return undefined
  return entry.value
}

function swatchFromTlColor(tlColor) {
  return COLOR_SWATCHES.find((swatch) => swatch.tl === tlColor)
}

function getGeoFillColor(shape) {
  if (typeof shape.meta?.fillColor === 'string') return shape.meta.fillColor
  if (shape.props?.fill === 'none') return null
  return swatchFromTlColor(shape.props?.color)?.bg ?? null
}

function getGeoFillOpacity(shape) {
  if (typeof shape.meta?.fillOpacity === 'number') return shape.meta.fillOpacity
  return shape.props?.fill === 'none' ? 0 : 1
}

function getTextSizePx(shape) {
  const baseSize = SIZE_TO_PX[shape.props?.size] ?? SIZE_TO_PX.m
  const scale = Number.isFinite(shape.props?.scale) ? shape.props.scale : 1
  return baseSize * scale
}

function getSharedTextSizePx(shapes) {
  if (!allShapesMatch(shapes, SHAPES_WITH_FREEFORM_TEXT_SIZE)) return undefined
  const first = getTextSizePx(shapes[0])
  return shapes.every((shape) => Math.abs(getTextSizePx(shape) - first) < 0.01) ? first : undefined
}

function getPresetSizeId(sizePx) {
  if (sizePx === undefined) return undefined
  return SIZES.find((size) => Math.abs(SIZE_TO_PX[size.id] - sizePx) < 0.01)?.id
}

function formatSizePx(sizePx) {
  const rounded = Math.round(sizePx * 10) / 10
  return String(rounded)
}

function clampTextSizePx(value) {
  return Math.max(1, Math.min(400, value))
}

function getNearestSizePreset(sizePx) {
  return SIZES.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(SIZE_TO_PX[nearest.id] - sizePx)
    const candidateDistance = Math.abs(SIZE_TO_PX[candidate.id] - sizePx)
    return candidateDistance < nearestDistance ? candidate : nearest
  })
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

// Detect the active list type from the richText JSON and shape meta
function getListTypeFromShape(shape) {
  const richText = shape.props?.richText
  if (!richText?.content) return 'none'
  const firstBlock = richText.content[0]
  if (!firstBlock) return 'none'
  if (firstBlock.type === 'bulletList') return 'bullet'
  if (firstBlock.type === 'orderedList') {
    // Check shape meta for list style
    if (shape.meta?.listStyle === 'roman') return 'roman'
    return 'ordered'
  }
  return 'none'
}

// Get shared list type across all selected shapes (undefined = mixed)
function getSharedListType(shapes) {
  if (shapes.length === 0) return 'none'
  const first = getListTypeFromShape(shapes[0])
  return shapes.every(s => getListTypeFromShape(s) === first) ? first : undefined
}

// Convert a richText doc's paragraphs into a bulletList or orderedList node,
// or unwrap back to plain paragraphs.
function convertRichTextToList(richText, listType) {
  const doc = richText ?? { type: 'doc', content: [{ type: 'paragraph' }] }
  const content = doc.content ?? []

  if (listType === 'none') {
    // Unwrap: flatten all listItem > paragraph content back to paragraphs
    const paragraphs = []
    for (const block of content) {
      if (block.type === 'bulletList' || block.type === 'orderedList') {
        for (const item of block.content ?? []) {
          for (const para of item.content ?? []) {
            paragraphs.push(para)
          }
        }
      } else {
        paragraphs.push(block)
      }
    }
    return { ...doc, content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }] }
  }

  // Wrap: collect all top-level paragraphs into listItems
  const listItems = []
  for (const block of content) {
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      // Re-wrap existing list items under new list type
      for (const item of block.content ?? []) {
        listItems.push(item)
      }
    } else {
      listItems.push({ type: 'listItem', content: [block] })
    }
  }
  
  const listNode = {
    type: listType === 'bullet' ? 'bulletList' : 'orderedList',
    content: listItems.length > 0 ? listItems : [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
  }
  
  return { ...doc, content: [listNode] }
}

export const ShapeInspector = track(function ShapeInspector() {
  const editor = useEditor()
  const inspectorRef = useRef(null)
  const [textSizeDraft, setTextSizeDraft] = useState('')
  const [panelSize, setPanelSize] = useState({ width: 340, height: 0 })

  const shapes = editor.getSelectedShapes()
  const activeTextSizePx = getSharedTextSizePx(shapes)

  useEffect(() => {
    setTextSizeDraft(activeTextSizePx === undefined ? '' : formatSizePx(activeTextSizePx))
  }, [activeTextSizePx])

  useEffect(() => {
    const panel = inspectorRef.current
    if (!panel) return undefined

    const syncPanelSize = () => {
      const nextWidth = panel.offsetWidth
      const nextHeight = panel.offsetHeight
      setPanelSize((current) => (
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      ))
    }

    syncPanelSize()
    const observer = new ResizeObserver(syncPanelSize)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  if (shapes.length === 0) return null

  // Don't interrupt typing / resizing / rotating
  const editing = editor.getEditingShapeId()
  if (editing) return null

  const showColor = allShapesMatch(shapes, SHAPES_WITH_COLOR)
  const isPermissiveColor = allShapesMatch(shapes, SHAPES_WITH_PERMISSIVE_COLOR)
  const isAutoEligible = allShapesMatch(shapes, SHAPES_WITH_AUTO_COLOR)
  const isAllAutoColor = isAutoEligible && shapes.every((s) => s.meta?.autoColor === true)
  const showFill = allShapesMatch(shapes, SHAPES_WITH_FILL)
  const showFont = allShapesMatch(shapes, SHAPES_WITH_TEXT)
  const showSize = allShapesMatch(shapes, SHAPES_WITH_SIZE)
  const showAlign = allShapesMatch(shapes, SHAPES_WITH_ALIGN)
  const showCorners = allShapesMatch(shapes, SHAPES_WITH_CORNERS)
  const showGeoCorners = allRectangleGeoShapes(shapes)
  const showImageStyling = allShapesMatch(shapes, SHAPES_WITH_IMAGE_STYLING)
  const showTextSizeInput = allShapesMatch(shapes, SHAPES_WITH_FREEFORM_TEXT_SIZE)
  const showLists = allShapesMatch(shapes, SHAPES_WITH_LISTS)
  const showArrowheads = allShapesMatch(shapes, SHAPES_WITH_ARROWHEADS)
  const showStrokeStyle = allShapesMatch(shapes, SHAPES_WITH_STROKE_STYLE)
  const showStrokeToggle = allShapesMatch(shapes, SHAPES_WITH_STROKE_TOGGLE)

  // Group selections and other unsupported shape sets previously rendered an
  // empty inspector shell here, which showed up as a blank floating bar.
  if (!(
    showColor
    || showFill
    || showFont
    || showSize
    || showAlign
    || showCorners
    || showGeoCorners
    || showImageStyling
    || showTextSizeInput
    || showLists
    || showArrowheads
    || showStrokeStyle
    || showStrokeToggle
  )) {
    return null
  }

  const bounds = editor.getSelectionRotatedPageBounds()
  if (!bounds) return null

  const zoomLevel = editor.getZoomLevel()
  const viewport = editor.getViewportScreenBounds()
  const topLeft = editor.pageToScreen({ x: bounds.minX, y: bounds.maxY })
  const topRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.maxY })
  const topCenter = editor.pageToScreen({ x: bounds.center.x, y: bounds.minY })
  const centerX = (topLeft.x + topRight.x) / 2
  const zoomScale = clamp(1 / Math.max(1, Math.sqrt(zoomLevel)), MIN_INSPECTOR_SCALE, MAX_INSPECTOR_SCALE)
  const widthScale = panelSize.width > 0
    ? Math.min(MAX_INSPECTOR_SCALE, (viewport.w - INSPECTOR_SCREEN_MARGIN * 2) / panelSize.width)
    : MAX_INSPECTOR_SCALE
  const heightScale = panelSize.height > 0
    ? Math.min(MAX_INSPECTOR_SCALE, (viewport.h - INSPECTOR_SCREEN_MARGIN * 2) / panelSize.height)
    : MAX_INSPECTOR_SCALE
  const inspectorScale = clamp(
    Math.min(zoomScale, widthScale, heightScale),
    MIN_INSPECTOR_SCALE,
    MAX_INSPECTOR_SCALE
  )
  const scaledWidth = panelSize.width * inspectorScale
  const scaledHeight = panelSize.height * inspectorScale
  const minX = viewport.x + INSPECTOR_SCREEN_MARGIN
  const maxX = Math.max(minX, viewport.x + viewport.w - scaledWidth - INSPECTOR_SCREEN_MARGIN)
  const minY = viewport.y + INSPECTOR_SCREEN_MARGIN
  const maxY = Math.max(minY, viewport.y + viewport.h - scaledHeight - INSPECTOR_SCREEN_MARGIN)
  const x = clamp(centerX - scaledWidth / 2, minX, maxX)
  const belowY = topLeft.y + INSPECTOR_GAP
  const aboveY = topCenter.y - scaledHeight - INSPECTOR_GAP
  const y = (
    belowY + scaledHeight <= viewport.y + viewport.h - INSPECTOR_SCREEN_MARGIN || aboveY < minY
      ? clamp(belowY, minY, maxY)
      : clamp(aboveY, minY, maxY)
  )

  const activeColor = sharedStyle(editor, DefaultColorStyle)
  const activeFillStyle = sharedStyle(editor, DefaultFillStyle)
  const activeFont  = sharedStyle(editor, DefaultFontStyle)
  const activeSize  = sharedStyle(editor, DefaultSizeStyle)
  const activeAlign = sharedStyle(editor, DefaultHorizontalAlignStyle)
  const activeStrokeStyle = showStrokeStyle ? sharedStyle(editor, DefaultDashStyle) : undefined
  const activeArrowheadStart = showArrowheads ? sharedStyle(editor, ArrowShapeArrowheadStartStyle) : undefined
  const activeArrowheadEnd   = showArrowheads ? sharedStyle(editor, ArrowShapeArrowheadEndStyle) : undefined
  const activeCorner = showCorners && shapes.every(
    s => Number(s.meta?.cornerRadius ?? 0) === Number(shapes[0].meta?.cornerRadius ?? 0)
  ) ? Number(shapes[0].meta?.cornerRadius ?? 0) : undefined
  const activeGeoCorner = showGeoCorners && shapes.every(
    s => Number(s.meta?.cornerRadius ?? 0) === Number(shapes[0].meta?.cornerRadius ?? 0)
  ) ? Number(shapes[0].meta?.cornerRadius ?? 0) : undefined
  const activeStrokeNone = showStrokeToggle && shapes.every(
    s => Boolean(s.meta?.strokeNone) === Boolean(shapes[0].meta?.strokeNone)
  ) ? Boolean(shapes[0].meta?.strokeNone) : undefined
  const activeImageCorner = showImageStyling && shapes.every(
    s => Number(s.meta?.imageCornerRadius ?? 0) === Number(shapes[0].meta?.imageCornerRadius ?? 0)
  ) ? Number(shapes[0].meta?.imageCornerRadius ?? 0) : undefined
  const activeImageBorder = showImageStyling && shapes.every(
    s => Number(s.meta?.imageBorderWidth ?? 0) === Number(shapes[0].meta?.imageBorderWidth ?? 0)
  ) ? Number(shapes[0].meta?.imageBorderWidth ?? 0) : undefined
  const activeImageBorderColor = showImageStyling && shapes.every(
    s => String(s.meta?.imageBorderColor ?? COLOR_SWATCHES[5].bg) === String(shapes[0].meta?.imageBorderColor ?? COLOR_SWATCHES[5].bg)
  ) ? String(shapes[0].meta?.imageBorderColor ?? COLOR_SWATCHES[5].bg) : undefined
  const activeFillColor = showFill && shapes.every(
    (s) => String(getGeoFillColor(s)) === String(getGeoFillColor(shapes[0]))
  ) ? getGeoFillColor(shapes[0]) ?? undefined : undefined
  const activeFillOpacity = showFill && shapes.every(
    (s) => Number(getGeoFillOpacity(s)) === Number(getGeoFillOpacity(shapes[0]))
  ) ? Number(getGeoFillOpacity(shapes[0])) : undefined
  const activeSizeButton = showTextSizeInput ? getPresetSizeId(activeTextSizePx) : activeSize
  const activeListType = showLists ? getSharedListType(shapes) : 'none'

  // Picking any regular color clears meta.autoColor on every selected shape
  // — otherwise a previously-magic shape would silently keep auto-flipping
  // after the user picked an explicit color.
  const applyColor = (tl) => editor.run(() => {
    editor.setStyleForSelectedShapes(DefaultColorStyle, tl)
    if (shapes.some((s) => s.meta?.autoColor)) {
      editor.updateShapes(
        shapes.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, autoColor: false } }))
      )
    }
  })
  // Magic / Auto swatch: stores props.color='black' AND meta.autoColor=true
  // on every selected shape. The 'black' value is the carrier — tldraw's
  // native auto-invert renders it as #1d1d1d in light mode and #f2f2f2 in
  // dark mode. The autoColor meta flag is what ShapeColorSync stamps as
  // `data-auto-color="true"` on the DOM, which lets tldraw.css EXCEPT this
  // shape from the `[data-tl-color='black'] .tl-text-content__wrapper`
  // override (so tldraw's mode-aware inline color wins). Result: when the
  // viewer toggles dark/light mode, the shape's text/stroke flips colors
  // automatically — true live-binding, not apply-time.
  const applyColorAuto = () => editor.run(() => {
    editor.setStyleForSelectedShapes(DefaultColorStyle, 'black')
    editor.updateShapes(
      shapes.map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, autoColor: true } }))
    )
  })
  const applyFillColor = (color) => editor.run(() => {
    editor.setStyleForSelectedShapes(DefaultFillStyle, 'solid')
    editor.updateShapes(
      shapes.map((s) => ({
        id: s.id,
        type: s.type,
        meta: {
          ...s.meta,
          fillColor: color,
          fillOpacity: Number(s.meta?.fillOpacity ?? DEFAULT_FILL_OPACITY),
        },
      }))
    )
  })
  const applyFillOpacity = (opacity) => editor.run(() => {
    if (opacity > 0) {
      editor.setStyleForSelectedShapes(DefaultFillStyle, 'solid')
    } else {
      editor.setStyleForSelectedShapes(DefaultFillStyle, 'none')
    }
    editor.updateShapes(
      shapes.map((s) => ({
        id: s.id,
        type: s.type,
        meta: {
          ...s.meta,
          fillColor: s.meta?.fillColor ?? swatchFromTlColor(s.props?.color)?.bg ?? COLOR_SWATCHES[0].bg,
          fillOpacity: opacity,
        },
      }))
    )
  })
  const applyFont   = (id) => editor.setStyleForSelectedShapes(DefaultFontStyle, id)
  const applyStrokeStyle = (id) => editor.setStyleForSelectedShapes(DefaultDashStyle, id)
  const applyTextSizePx = (value) => {
    const nextSizePx = clampTextSizePx(value)
    const preset = getNearestSizePreset(nextSizePx)
    editor.updateShapes(
      shapes.map((shape) => ({
        id: shape.id,
        type: shape.type,
        props: {
          size: preset.id,
          scale: nextSizePx / SIZE_TO_PX[preset.id],
        },
      }))
    )
  }
  const applySize = (id) => {
    if (showTextSizeInput) {
      editor.updateShapes(
        shapes.map((shape) => ({
          id: shape.id,
          type: shape.type,
          props: { size: id, scale: 1 },
        }))
      )
      return
    }
    editor.setStyleForSelectedShapes(DefaultSizeStyle, id)
  }
  const commitTextSizeDraft = () => {
    if (!showTextSizeInput) return
    const parsed = Number(textSizeDraft)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setTextSizeDraft(activeTextSizePx === undefined ? '' : formatSizePx(activeTextSizePx))
      return
    }
    applyTextSizePx(parsed)
  }
  const applyAlign  = (id) => editor.run(() => {
    shapes.forEach((s) => {
      if (s.type === 'text') {
        editor.updateShapes([
          {
            id: s.id,
            type: s.type,
            props: { textAlign: id === 'start' ? 'start' : id === 'middle' ? 'middle' : 'end' },
          },
        ])
      } else {
        editor.updateShapes([
          {
            id: s.id,
            type: s.type,
            props: { align: id },
          },
        ])
      }
    })
  })
  const updateMeta = (key, value) => editor.updateShapes(
    shapes.map(s => ({ id: s.id, type: s.type, meta: { ...s.meta, [key]: value } }))
  )
  const applyCorner = (rx) => updateMeta('cornerRadius', rx)
  // GeoCornerStyles only rounds corners when dash !== 'draw' (sketchy strokes
  // overshoot the bounding box and would be clipped). Auto-switch to solid
  // when the user actually picks a non-zero radius so the click takes effect
  // even on the default sketchy dash.
  const applyGeoCorner = (rx) => editor.run(() => {
    if (rx > 0) editor.setStyleForSelectedShapes(DefaultDashStyle, 'solid')
    updateMeta('cornerRadius', rx)
  })
  const applyImageCorner = (rx) => updateMeta('imageCornerRadius', rx)
  const applyImageBorder = (width) => updateMeta('imageBorderWidth', width)
  const applyImageBorderColor = (color) => updateMeta('imageBorderColor', color)
  const applyArrowheadStart = (id) => editor.setStyleForSelectedShapes(ArrowShapeArrowheadStartStyle, id)
  const applyArrowheadEnd   = (id) => editor.setStyleForSelectedShapes(ArrowShapeArrowheadEndStyle, id)
  const applyStrokeNone = (none) => updateMeta('strokeNone', none)
  const applyListType = (listType) => {
    editor.updateShapes(
      shapes.map(s => ({
        id: s.id,
        type: s.type,
        props: {
          richText: convertRichTextToList(s.props?.richText, listType),
        },
        meta: {
          ...s.meta,
          listStyle: listType === 'roman' ? 'roman' : listType === 'ordered' ? 'decimal' : null,
        },
      }))
    )
  }

  return (
    <div
      ref={inspectorRef}
      className="shape-inspector"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: `scale(${inspectorScale})`,
        transformOrigin: 'top left',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      // After any button inside the inspector is clicked, browser focus
      // transfers to that <button> and tldraw's `isFocused` flips to false.
      // tldraw then silently drops keyboard shortcuts — including Escape,
      // which is the only way to unwind focused-group → edit-mode → selection
      // after a double-click into a grouped shape. Returning focus to the
      // editor on pointerup keeps keyboard shortcuts alive. Deferred to the
      // next microtask so the button click registers first.
      onPointerUp={() => { queueMicrotask(() => editor.focus()) }}
    >
      {(showColor || showImageStyling) && (
        <div className="insp-row">
          <div className="insp-label">Color</div>
          <div
            className="insp-body insp-body-swatches"
            data-color-context={
              showImageStyling
                ? 'image'
                : isPermissiveColor
                  ? 'permissive'
                  : 'stroke'
            }
          >
            {/* Auto / Magic swatch — only renders when SHAPES_WITH_AUTO_COLOR
                covers the whole selection (text / draw). Highlight is in
                SHAPES_WITH_PERMISSIVE_COLOR but NOT here, because tldraw's
                highlight tool re-maps every color name to a fluorescent
                hex (`black` highlight = yellow), which would defeat the
                "auto-flip with mode" intent. The active class fires when
                every selected shape carries meta.autoColor — that's the
                source of truth for "this shape is in magic mode". */}
            {isAutoEligible && (
              <button
                key="auto"
                className={`insp-swatch ${isAllAutoColor ? 'active' : ''}`}
                onClick={applyColorAuto}
                title="Auto (follows canvas mode — flips with light/dark toggle)"
                type="button"
                data-swatch-id="auto"
              />
            )}
            {COLOR_SWATCHES.map((c) => {
              // When the selection is in magic mode, suppress regular
              // active highlights — the Auto chip is the active one even
              // though the stored props.color is 'black'.
              const colorActive = showImageStyling
                ? activeImageBorderColor === c.bg
                : !isAllAutoColor && activeColor === c.tl
              return (
                <button
                  key={c.id}
                  className={`insp-swatch ${colorActive ? 'active' : ''}`}
                  style={{ background: c.bg }}
                  onClick={() => (showImageStyling ? applyImageBorderColor(c.bg) : applyColor(c.tl))}
                  title={c.id}
                  type="button"
                  data-swatch-id={c.id}
                />
              )
            })}
          </div>
        </div>
      )}

      {showFill && (
        <div className="insp-row">
          <div className="insp-label">Fill</div>
          <div className="insp-body insp-body-swatches" data-color-context="fill">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c.id}
                className={`insp-swatch ${activeFillColor === c.bg ? 'active' : ''}`}
                style={{ background: c.bg }}
                onClick={() => applyFillColor(c.bg)}
                title={c.id}
                type="button"
                data-swatch-id={c.id}
              />
            ))}
          </div>
        </div>
      )}

      {showFill && (
        <div className="insp-row">
          <div className="insp-label">Opacity</div>
          <div className="insp-body">
            {FILL_OPACITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`insp-btn ${activeFillOpacity === option.id || (option.id === 0 && activeFillStyle === 'none') ? 'active' : ''}`}
                onClick={() => applyFillOpacity(option.id)}
                title={option.title}
                type="button"
              >{option.label}</button>
            ))}
          </div>
        </div>
      )}

      {showStrokeToggle && (
        <div className="insp-row">
          <div className="insp-label">Border</div>
          <div className="insp-body">
            {STROKE_TOGGLE_OPTIONS.map((option) => {
              const isOn = option.id === 'on'
              const active = activeStrokeNone === undefined
                ? false
                : isOn ? !activeStrokeNone : activeStrokeNone
              return (
                <button
                  key={option.id}
                  className={`insp-btn ${active ? 'active' : ''}`}
                  onClick={() => applyStrokeNone(!isOn)}
                  title={option.title}
                  type="button"
                >{option.label}</button>
              )
            })}
          </div>
        </div>
      )}

      {showStrokeStyle && (
        <div className="insp-row">
          <div className="insp-label">Stroke</div>
          <div className="insp-body">
            {STROKE_STYLE_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`insp-btn ${activeStrokeStyle === option.id ? 'active' : ''}`}
                onClick={() => applyStrokeStyle(option.id)}
                title={option.title}
                type="button"
              >{option.shortLabel}</button>
            ))}
          </div>
        </div>
      )}

      {showFont && (
        <div className="insp-row">
          <div className="insp-label">Font</div>
          <div className="insp-body insp-body-pills">
            {FONTS.map((f) => {
              const Icon = f.Icon
              return (
                <button
                  key={f.id}
                  className={`font-pill ${activeFont === f.id ? 'active' : ''}`}
                  onClick={() => applyFont(f.id)}
                  title={f.label}
                  type="button"
                >
                  <Icon />
                  <span className="font-pill-label">{f.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {showSize && (
        <div className="insp-row">
          <div className="insp-label">Size</div>
          <div className="insp-body insp-body-size">
            {showTextSizeInput && (
              <button
                className={`insp-btn ${activeTextSizePx !== undefined && Math.abs(activeTextSizePx - 5) < 0.5 ? 'active' : ''}`}
                onClick={() => applyTextSizePx(5)}
                type="button"
              >XS</button>
            )}
            {SIZES.map((s) => (
              <button
                key={s.id}
                className={`insp-btn ${activeSizeButton === s.id ? 'active' : ''}`}
                onClick={() => applySize(s.id)}
                type="button"
              >{s.label}</button>
            ))}
            {showTextSizeInput && (
              <input
                className="insp-number"
                type="number"
                inputMode="numeric"
                min="1"
                max="400"
                step="1"
                value={textSizeDraft}
                onChange={(e) => setTextSizeDraft(e.target.value)}
                onBlur={commitTextSizeDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Escape') {
                    setTextSizeDraft(activeTextSizePx === undefined ? '' : formatSizePx(activeTextSizePx))
                    e.currentTarget.blur()
                  }
                }}
                aria-label="Text size"
              />
            )}
          </div>
        </div>
      )}

      {showAlign && (
        <div className="insp-row">
          <div className="insp-label">Align</div>
          <div className="insp-body">
            {ALIGNS.map((a) => (
              <button
                key={a.id}
                className={`insp-btn ${activeAlign === a.id ? 'active' : ''}`}
                onClick={() => applyAlign(a.id)}
                title={a.title}
                type="button"
              >{a.label}</button>
            ))}
          </div>
        </div>
      )}

      {showLists && (
        <div className="insp-row">
          <div className="insp-label">List</div>
          <div className="insp-body">
            {LIST_TYPES.map((list) => (
              <button
                key={list.id}
                className={`insp-btn ${activeListType === list.id ? 'active' : ''}`}
                onClick={() => applyListType(list.id)}
                title={list.title}
                type="button"
              >{list.label}</button>
            ))}
          </div>
        </div>
      )}

      {showCorners && (
        <div className="insp-row">
          <div className="insp-label">Corners</div>
          <div className="insp-body">
            {CORNER_OPTIONS.map((c) => (
              <button
                key={c.id}
                className={`insp-btn ${activeCorner === c.id ? 'active' : ''}`}
                onClick={() => applyCorner(c.id)}
                title={c.title}
                type="button"
              ><span className={`corner-swatch ${c.cls}`} /></button>
            ))}
          </div>
        </div>
      )}

      {showGeoCorners && (
        <div className="insp-row">
          <div className="insp-label">Corners</div>
          <div className="insp-body">
            {CORNER_OPTIONS.map((c) => (
              <button
                key={c.id}
                className={`insp-btn ${activeGeoCorner === c.id ? 'active' : ''}`}
                onClick={() => applyGeoCorner(c.id)}
                title={c.title}
                type="button"
              ><span className={`corner-swatch ${c.cls}`} /></button>
            ))}
          </div>
        </div>
      )}

      {showArrowheads && (
        <div className="insp-row">
          <div className="insp-label">From</div>
          <div className="insp-body insp-body-arrowheads">
            {ARROWHEAD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`insp-btn insp-btn-glyph ${activeArrowheadStart === opt.id ? 'active' : ''}`}
                onClick={() => applyArrowheadStart(opt.id)}
                title={opt.title}
                type="button"
              >{opt.glyph}</button>
            ))}
          </div>
        </div>
      )}

      {showArrowheads && (
        <div className="insp-row">
          <div className="insp-label">To</div>
          <div className="insp-body insp-body-arrowheads">
            {ARROWHEAD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className={`insp-btn insp-btn-glyph ${activeArrowheadEnd === opt.id ? 'active' : ''}`}
                onClick={() => applyArrowheadEnd(opt.id)}
                title={opt.title}
                type="button"
              >{opt.glyph}</button>
            ))}
          </div>
        </div>
      )}

      {showImageStyling && (
        <div className="insp-row">
          <div className="insp-label">Corners</div>
          <div className="insp-body">
            {CORNER_OPTIONS.map((c) => (
              <button
                key={c.id}
                className={`insp-btn ${activeImageCorner === c.id ? 'active' : ''}`}
                onClick={() => applyImageCorner(c.id)}
                title={c.title}
                type="button"
              ><span className={`corner-swatch ${c.cls}`} /></button>
            ))}
          </div>
        </div>
      )}

      {showImageStyling && (
        <div className="insp-row">
          <div className="insp-label">Border</div>
          <div className="insp-body">
            {IMAGE_BORDER_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`insp-btn ${activeImageBorder === option.id ? 'active' : ''}`}
                onClick={() => applyImageBorder(option.id)}
                title={option.title}
                type="button"
              >{option.label}</button>
            ))}
          </div>
        </div>
      )}

    </div>
  )
})
