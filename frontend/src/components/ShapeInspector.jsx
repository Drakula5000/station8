import { track, useEditor, DefaultColorStyle, DefaultFontStyle, DefaultSizeStyle, DefaultHorizontalAlignStyle } from 'tldraw'
import { FjDraftIcon, FjDataIcon, FjAnalysisIcon, FjInsightIcon } from '../icons'

// Aurora palette — must stay in sync with STICKY_SWATCHES in TldrawCanvas.jsx.
// bg = what the swatch shows = what you'll see on the canvas.
const COLOR_SWATCHES = [
  { id: 'lavender', bg: '#C8B0F5', tl: 'light-violet' },
  { id: 'pink',     bg: '#F0A8C0', tl: 'light-red' },
  { id: 'blue',     bg: '#90BCE8', tl: 'light-blue' },
  { id: 'teal',     bg: '#88D4B0', tl: 'light-green' },
  { id: 'orange',   bg: '#F0B880', tl: 'orange' },
  { id: 'purple',   bg: '#B8A0F8', tl: 'violet' },
  { id: 'red',      bg: '#e87890', tl: 'red' },
  { id: 'grey',     bg: '#8898b0', tl: 'grey' },
]

const FONTS = [
  { id: 'draw',  label: 'Draft',    Icon: FjDraftIcon },
  { id: 'mono',  label: 'Data',     Icon: FjDataIcon },
  { id: 'sans',  label: 'Analysis', Icon: FjAnalysisIcon },
  { id: 'serif', label: 'Insight',  Icon: FjInsightIcon },
]

const SIZES = [
  { id: 's',  label: 'S' },
  { id: 'm',  label: 'M' },
  { id: 'l',  label: 'L' },
  { id: 'xl', label: 'XL' },
]

const ALIGNS = [
  { id: 'start',  label: '⟵', title: 'Left' },
  { id: 'middle', label: '↔',  title: 'Center' },
  { id: 'end',    label: '⟶', title: 'Right' },
]

const CORNER_OPTIONS = [
  { id: 0,  cls: 'corner-swatch-0',  title: 'Sharp' },
  { id: 8,  cls: 'corner-swatch-8',  title: 'Soft' },
  { id: 16, cls: 'corner-swatch-16', title: 'Round' },
  { id: 32, cls: 'corner-swatch-32', title: 'Pill' },
]

const IMAGE_BORDER_OPTIONS = [
  { id: 0, label: 'Off', title: 'No border' },
  { id: 2, label: 'Thin', title: 'Thin border' },
  { id: 4, label: 'Bold', title: 'Bold border' },
]

// Which control rows apply to which shape types.
// Keep conservative — show a control only when ALL selected shapes support it.
const SHAPES_WITH_COLOR   = new Set(['note', 'geo', 'text', 'arrow', 'line', 'draw', 'frame', 'highlight'])
const SHAPES_WITH_TEXT    = new Set(['note', 'geo', 'text', 'arrow'])
const SHAPES_WITH_SIZE    = new Set(['note', 'geo', 'text', 'arrow', 'line', 'draw'])
const SHAPES_WITH_ALIGN   = new Set(['note', 'geo', 'text'])
const SHAPES_WITH_CORNERS = new Set(['frame'])
const SHAPES_WITH_IMAGE_STYLING = new Set(['image'])

function allShapesMatch(shapes, set) {
  return shapes.length > 0 && shapes.every((s) => set.has(s.type))
}

// Pluck a shared style value across a selection. Returns undefined when
// the shapes disagree (so no swatch shows active).
function sharedStyle(editor, styleProp) {
  const shared = editor.getSharedStyles()
  const entry = shared.get(styleProp)
  if (!entry || entry.type === 'mixed') return undefined
  return entry.value
}

export const ShapeInspector = track(function ShapeInspector() {
  const editor = useEditor()
  const shapes = editor.getSelectedShapes()
  if (shapes.length === 0) return null

  // Don't interrupt typing / resizing / rotating
  const editing = editor.getEditingShapeId()
  if (editing) return null

  const bounds = editor.getSelectionRotatedPageBounds()
  if (!bounds) return null

  const topLeft = editor.pageToScreen({ x: bounds.minX, y: bounds.maxY })
  const topRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.maxY })
  const centerX = (topLeft.x + topRight.x) / 2

  const showColor   = allShapesMatch(shapes, SHAPES_WITH_COLOR)
  const showFont    = allShapesMatch(shapes, SHAPES_WITH_TEXT)
  const showSize    = allShapesMatch(shapes, SHAPES_WITH_SIZE)
  const showAlign   = allShapesMatch(shapes, SHAPES_WITH_ALIGN)
  const showCorners = allShapesMatch(shapes, SHAPES_WITH_CORNERS)
  const showImageStyling = allShapesMatch(shapes, SHAPES_WITH_IMAGE_STYLING)

  const activeColor = sharedStyle(editor, DefaultColorStyle)
  const activeFont  = sharedStyle(editor, DefaultFontStyle)
  const activeSize  = sharedStyle(editor, DefaultSizeStyle)
  const activeAlign = sharedStyle(editor, DefaultHorizontalAlignStyle)
  const activeCorner = showCorners && shapes.every(
    s => Number(s.meta?.cornerRadius ?? 0) === Number(shapes[0].meta?.cornerRadius ?? 0)
  ) ? Number(shapes[0].meta?.cornerRadius ?? 0) : undefined
  const activeImageCorner = showImageStyling && shapes.every(
    s => Number(s.meta?.imageCornerRadius ?? 0) === Number(shapes[0].meta?.imageCornerRadius ?? 0)
  ) ? Number(shapes[0].meta?.imageCornerRadius ?? 0) : undefined
  const activeImageBorder = showImageStyling && shapes.every(
    s => Number(s.meta?.imageBorderWidth ?? 0) === Number(shapes[0].meta?.imageBorderWidth ?? 0)
  ) ? Number(shapes[0].meta?.imageBorderWidth ?? 0) : undefined
  const activeImageBorderColor = showImageStyling && shapes.every(
    s => String(s.meta?.imageBorderColor ?? COLOR_SWATCHES[5].bg) === String(shapes[0].meta?.imageBorderColor ?? COLOR_SWATCHES[5].bg)
  ) ? String(shapes[0].meta?.imageBorderColor ?? COLOR_SWATCHES[5].bg) : undefined

  const applyColor  = (tl) => editor.setStyleForSelectedShapes(DefaultColorStyle, tl)
  const applyFont   = (id) => editor.setStyleForSelectedShapes(DefaultFontStyle, id)
  const applySize   = (id) => editor.setStyleForSelectedShapes(DefaultSizeStyle, id)
  const applyAlign  = (id) => editor.setStyleForSelectedShapes(DefaultHorizontalAlignStyle, id)
  const applyCorner = (rx) => editor.updateShapes(
    shapes.map(s => ({ id: s.id, type: s.type, meta: { ...s.meta, cornerRadius: rx } }))
  )
  const applyImageCorner = (rx) => editor.updateShapes(
    shapes.map(s => ({ id: s.id, type: s.type, meta: { ...s.meta, imageCornerRadius: rx } }))
  )
  const applyImageBorder = (width) => editor.updateShapes(
    shapes.map(s => ({ id: s.id, type: s.type, meta: { ...s.meta, imageBorderWidth: width } }))
  )
  const applyImageBorderColor = (color) => editor.updateShapes(
    shapes.map(s => ({ id: s.id, type: s.type, meta: { ...s.meta, imageBorderColor: color } }))
  )

  return (
    <div
      className="shape-inspector"
      style={{
        left: `${centerX}px`,
        top: `${topLeft.y + 14}px`,
        transform: 'translateX(-50%)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {(showColor || showImageStyling) && (
        <div className="insp-row">
          <div className="insp-label">Color</div>
          <div className="insp-body insp-body-swatches">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c.id}
                className={`insp-swatch ${(showImageStyling ? activeImageBorderColor === c.bg : activeColor === c.tl) ? 'active' : ''}`}
                style={{ background: c.bg }}
                onClick={() => (showImageStyling ? applyImageBorderColor(c.bg) : applyColor(c.tl))}
                title={c.id}
                type="button"
              />
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
          <div className="insp-body">
            {SIZES.map((s) => (
              <button
                key={s.id}
                className={`insp-btn ${activeSize === s.id ? 'active' : ''}`}
                onClick={() => applySize(s.id)}
                type="button"
              >{s.label}</button>
            ))}
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
