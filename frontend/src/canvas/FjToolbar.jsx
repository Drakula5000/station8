import { useState, useEffect, useRef } from 'react'
import {
  track, useEditor,
  DefaultColorStyle, DefaultDashStyle, DefaultSizeStyle, GeoShapeGeoStyle,
  TldrawUiButtonIcon,
} from 'tldraw'
import {
  FjCursorIcon, FjHandIcon, FjStickyIcon, FjTextIcon, FjArrowIcon, FjPenIcon, FjSectionIcon,
  FjEllipseIcon, FjDiamondIcon, FjRectIcon, FjLineIcon, FjChevronDownIcon,
  FjTriangleIcon, FjHexagonIcon, FjStarIcon, FjOvalIcon, FjTrapezoidIcon,
  FjArrowRightIcon, FjArrowLeftIcon, FjArrowUpIcon, FjArrowDownIcon,
  FjXBoxIcon, FjCheckBoxIcon, FjCloudIcon, FjHeartIcon,
  FjMarkerIcon,
} from '../icons'
import { AURORA_SWATCHES, STICKY_SWATCHES, HIGHLIGHT_SWATCHES } from '../colors'
import { resolveImageShapeUrl } from './shared'
import { STROKE_STYLE_OPTIONS, SIZE_OPTIONS } from './styleOptions'

// Section/highlight pastel palette — bg/stroke pairs for FigJam-style frames.
// Color values come from --s8-section-* tokens defined in App.css :root.
const SECTION_SWATCHES = {
  violet: { bg: 'var(--s8-section-violet-bg)', stroke: 'var(--s8-section-violet-stroke)', tl: 'violet' },
  teal:   { bg: 'var(--s8-section-teal-bg)',   stroke: 'var(--s8-section-teal-stroke)',   tl: 'green' },
  blue:   { bg: 'var(--s8-section-blue-bg)',   stroke: 'var(--s8-section-blue-stroke)',   tl: 'blue' },
  rose:   { bg: 'var(--s8-section-rose-bg)',   stroke: 'var(--s8-section-rose-stroke)',   tl: 'light-red' },
  amber:  { bg: 'var(--s8-section-amber-bg)',  stroke: 'var(--s8-section-amber-stroke)',  tl: 'orange' },
  slate:  { bg: 'var(--s8-section-slate-bg)',  stroke: 'var(--s8-section-slate-stroke)',  tl: 'grey' },
}

const GEO_SHAPES = [
  { id: 'rectangle',   Icon: FjRectIcon },
  { id: 'ellipse',     Icon: FjEllipseIcon },
  { id: 'triangle',    Icon: FjTriangleIcon },
  { id: 'diamond',     Icon: FjDiamondIcon },
  { id: 'hexagon',     Icon: FjHexagonIcon },
  { id: 'star',        Icon: FjStarIcon },
  { id: 'oval',        Icon: FjOvalIcon },
  { id: 'trapezoid',   Icon: FjTrapezoidIcon },
  { id: 'arrow-left',  Icon: FjArrowLeftIcon },
  { id: 'arrow-up',    Icon: FjArrowUpIcon },
  { id: 'arrow-down',  Icon: FjArrowDownIcon },
  { id: 'arrow-right', Icon: FjArrowRightIcon },
  { id: 'cloud',       Icon: FjCloudIcon },
  { id: 'heart',       Icon: FjHeartIcon },
  { id: 'x-box',       Icon: FjXBoxIcon },
  { id: 'check-box',   Icon: FjCheckBoxIcon },
]

const SHAPE_ICON_MAP = Object.fromEntries([...GEO_SHAPES.map(s => [s.id, s.Icon]), ['line', FjLineIcon]])

export const FjToolbar = track(function FjToolbar({ toolInfoRef, onOpenLightbox, onToolChange }) {
  const editor = useEditor()
  const [stickyPickerOpen, setStickyPickerOpen] = useState(false)
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false)
  const [shapePickerOpen, setShapePickerOpen] = useState(false)
  const [drawPickerOpen, setDrawPickerOpen] = useState(false)
  const [markerPickerOpen, setMarkerPickerOpen] = useState(false)
  const [editingAltText, setEditingAltText] = useState(false)
  const [altTextDraft, setAltTextDraft] = useState('')
  const [lastStickyColor, setLastStickyColor] = useState('yellow')
  const [lastSectionColor, setLastSectionColor] = useState('violet')
  const [lastShape, setLastShape] = useState('ellipse')
  const [lastDrawColor, setLastDrawColor] = useState('blue')
  const [lastDrawDash, setLastDrawDash] = useState('draw')
  const [lastDrawSize, setLastDrawSize] = useState('m')
  // True while "Auto" is the active pen color. The next-shape style API
  // doesn't carry meta, so we use a ref + a sideEffects handler to inject
  // meta.autoColor on each draw shape created while this is on. Switching
  // to any explicit color flips this back to false.
  const pendingAutoColorRef = useRef(false)
  const [lastMarkerColor, setLastMarkerColor] = useState('blue')
  const [lastMarkerSize, setLastMarkerSize] = useState('m')

  const currentTool = editor.getCurrentToolId()
  const selectedImage = editor.getOnlySelectedShape()?.type === 'image' ? editor.getOnlySelectedShape() : null

  useEffect(() => {
    if (!selectedImage) {
      setEditingAltText(false)
      setAltTextDraft('')
      return
    }
    setAltTextDraft(selectedImage.meta?.altText || '')
  }, [selectedImage])

  // Keep toolInfoRef in sync so TldrawCanvas can render the ghost
  if (toolInfoRef) {
    toolInfoRef.current.tool = currentTool
    toolInfoRef.current.stickyColor = lastStickyColor
  }

  useEffect(() => {
    onToolChange?.(currentTool)
  }, [currentTool, onToolChange])

  useEffect(() => {
    const onClick = (e) => {
      if (!e.target.closest('.sticky-btn-wrap')) setStickyPickerOpen(false)
      if (!e.target.closest('.section-btn-wrap')) setSectionPickerOpen(false)
      if (!e.target.closest('.shape-btn-wrap')) setShapePickerOpen(false)
      if (!e.target.closest('.draw-btn-wrap')) setDrawPickerOpen(false)
      if (!e.target.closest('.marker-btn-wrap')) setMarkerPickerOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setStickyPickerOpen(false)
        setSectionPickerOpen(false)
        setShapePickerOpen(false)
        setDrawPickerOpen(false)
        setMarkerPickerOpen(false)
      }
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const closeAll = () => {
    setStickyPickerOpen(false)
    setSectionPickerOpen(false)
    setShapePickerOpen(false)
    setDrawPickerOpen(false)
    setMarkerPickerOpen(false)
  }

  const stopToolbarPointer = (e) => {
    e.stopPropagation()
  }

  const startImageCrop = () => {
    if (!selectedImage) return
    editor.select(selectedImage.id)
    editor.setCurrentTool('select.crop.idle')
  }

  const replaceImage = async () => {
    if (!selectedImage) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) {
        editor.markHistoryStoppingPoint('replace image')
        editor.replaceExternalContent({
          type: 'file-replace',
          file,
          shapeId: selectedImage.id,
          isImage: true,
        })
      }
      input.remove()
    }, { once: true })
    input.click()
  }

  const downloadImage = async () => {
    if (!selectedImage) return
    const url = await resolveImageShapeUrl(editor, selectedImage)
    if (!url) return
    const asset = selectedImage.props.assetId ? editor.getAsset(selectedImage.props.assetId) : null
    const resp = await fetch(url)
    if (!resp.ok) {
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    const blob = await resp.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = asset?.props?.name || 'image'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(link.href)
  }

  const expandImage = async () => {
    if (!selectedImage || !onOpenLightbox) return
    const url = await resolveImageShapeUrl(editor, selectedImage)
    if (!url) return
    onOpenLightbox({ src: url, alt: selectedImage.meta?.altText || '' })
  }

  const saveAltText = () => {
    if (!selectedImage) return
    editor.updateShapes([{
      id: selectedImage.id,
      type: 'image',
      meta: { ...selectedImage.meta, altText: altTextDraft },
    }])
    setEditingAltText(false)
  }

  const setTool = (tool) => {
    editor.setCurrentTool(tool)
    closeAll()
  }

  const applyNextDrawStyles = ({
    color = lastDrawColor,
    dash = lastDrawDash,
    size = lastDrawSize,
  } = {}) => {
    setLastDrawColor(color)
    setLastDrawDash(dash)
    setLastDrawSize(size)
    try { editor.setStyleForNextShapes(DefaultColorStyle, color) } catch { /* no-op */ }
    try { editor.setStyleForNextShapes(DefaultDashStyle, dash) } catch { /* no-op */ }
    try { editor.setStyleForNextShapes(DefaultSizeStyle, size) } catch { /* no-op */ }
  }

  const activateDraw = () => {
    applyNextDrawStyles()
    editor.setCurrentTool('draw')
    closeAll()
  }

  const setDrawColor = (color) => {
    // Picking an explicit color exits magic-pen mode so subsequent strokes
    // get a fixed hue without the auto-flip behavior.
    pendingAutoColorRef.current = false
    applyNextDrawStyles({ color })
    editor.setCurrentTool('draw')
  }

  // "Magic" pen — applies tldraw color 'black' as the carrier and arms a
  // ref so the sideEffects handler below stamps meta.autoColor=true on
  // each draw shape created while the magic mode is active. Tldraw's
  // native palette renders 'black' as #1d1d1d in light mode and #f2f2f2
  // in dark mode; combined with the `:not([data-auto-color='true'])`
  // exception in tldraw.css, the resulting stroke color live-binds to
  // whatever mode the viewer is currently in — flips on toggle.
  const setDrawColorAuto = () => {
    applyNextDrawStyles({ color: 'black' })
    editor.setCurrentTool('draw')
    pendingAutoColorRef.current = true
  }

  useEffect(() => {
    // Side-effect handler: any draw/highlight shape created while the
    // magic pen is armed gets meta.autoColor=true so ShapeColorSync stamps
    // data-auto-color on it. Filter to draw + highlight only — other
    // shape types could be created via different tools and shouldn't
    // accidentally inherit the flag.
    const cleanup = editor.sideEffects.register({
      shape: {
        afterCreate: (shape) => {
          if (!pendingAutoColorRef.current) return
          if (shape.type !== 'draw' && shape.type !== 'highlight') return
          editor.updateShape({
            id: shape.id,
            type: shape.type,
            meta: { ...shape.meta, autoColor: true },
          })
        },
      },
    })
    return cleanup
  }, [editor])

  const setDrawStroke = (strokeId) => {
    applyNextDrawStyles({ dash: strokeId })
    editor.setCurrentTool('draw')
  }

  const setDrawSize = (size) => {
    applyNextDrawStyles({ size })
    editor.setCurrentTool('draw')
  }

  const activateMarker = (color = lastMarkerColor, size = lastMarkerSize) => {
    setLastMarkerColor(color)
    setLastMarkerSize(size)
    try { editor.setStyleForNextShapes(DefaultColorStyle, color) } catch { /* no-op */ }
    try { editor.setStyleForNextShapes(DefaultSizeStyle, size) } catch { /* no-op */ }
    editor.setCurrentTool('highlight')
    closeAll()
  }

  const setMarkerColor = (color) => {
    setLastMarkerColor(color)
    try { editor.setStyleForNextShapes(DefaultColorStyle, color) } catch { /* no-op */ }
    editor.setCurrentTool('highlight')
  }

  const setMarkerSize = (size) => {
    setLastMarkerSize(size)
    try { editor.setStyleForNextShapes(DefaultSizeStyle, size) } catch { /* no-op */ }
    editor.setCurrentTool('highlight')
  }

  const placeNote = (color) => {
    setLastStickyColor(color)
    if (toolInfoRef) toolInfoRef.current.stickyColor = color
    try { editor.setStyleForNextShapes(DefaultColorStyle, STICKY_SWATCHES[color]?.tl || 'yellow') } catch { /* no-op */ }
    try { editor.setStyleForNextShapes(DefaultSizeStyle, 's') } catch { /* no-op */ }
    editor.setCurrentTool('note')
    closeAll()
  }

  const placeFrame = (color) => {
    setLastSectionColor(color)
    try { editor.setStyleForNextShapes(DefaultColorStyle, SECTION_SWATCHES[color]?.tl || 'blue') } catch { /* no-op */ }
    editor.setCurrentTool('frame')
    closeAll()
  }

  const setShape = (shape) => {
    setLastShape(shape)
    if (shape === 'line') {
      editor.setCurrentTool('line')
    } else {
      try { editor.setStyleForNextShapes(GeoShapeGeoStyle, shape) } catch { /* no-op */ }
      try {
        editor.setStyleForNextShapes(
          DefaultDashStyle,
          shape === 'rectangle' || shape === 'diamond' ? 'solid' : 'draw'
        )
      } catch { /* no-op */ }
      editor.setCurrentTool('geo')
    }
    closeAll()
  }

  return (
    <>
    <div
      className="fj-toolbar"
      onPointerDownCapture={stopToolbarPointer}
      onMouseDownCapture={stopToolbarPointer}
    >
      <button
        className={`fj-tool ${currentTool === 'select' ? 'active' : ''}`}
        onClick={() => setTool('select')}
        onPointerDown={stopToolbarPointer}
        title="Select"
        type="button"
      ><FjCursorIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'hand' ? 'active' : ''}`}
        onClick={() => setTool('hand')}
        onPointerDown={stopToolbarPointer}
        title="Hand"
        type="button"
      ><FjHandIcon /></button>

      <div className="fj-sep" />

      {/* Sticky notes */}
      <div className="sticky-btn-wrap">
        <div className={`fj-split ${stickyPickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${currentTool === 'note' ? 'active' : ''}`}
            onClick={() => placeNote(lastStickyColor)}
            onPointerDown={stopToolbarPointer}
            title="Sticky note"
            type="button"
          ><FjStickyIcon color={lastStickyColor} /></button>
          <button
            className={`fj-tool fj-tool-caret ${stickyPickerOpen ? 'active' : ''}`}
            onClick={() => { setStickyPickerOpen(o => !o); setSectionPickerOpen(false); setShapePickerOpen(false); setDrawPickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {stickyPickerOpen && (
          <div className="section-picker" onClick={e => e.stopPropagation()}>
            <div className="section-picker-title">Sticky color</div>
            <div className="section-picker-grid">
              {Object.entries(STICKY_SWATCHES).map(([key, c]) => (
                <button
                  key={key}
                  className="section-swatch"
                  style={{ background: c.bg }}
                  onClick={() => placeNote(key)}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sections / frames */}
      <div className="section-btn-wrap">
        <div className={`fj-split ${sectionPickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${currentTool === 'frame' ? 'active' : ''}`}
            onClick={() => placeFrame(lastSectionColor)}
            onPointerDown={stopToolbarPointer}
            title="Section"
            type="button"
          ><FjSectionIcon /></button>
          <button
            className={`fj-tool fj-tool-caret ${sectionPickerOpen ? 'active' : ''}`}
            onClick={() => { setSectionPickerOpen(o => !o); setStickyPickerOpen(false); setShapePickerOpen(false); setDrawPickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {sectionPickerOpen && (
          <div className="section-picker" onClick={e => e.stopPropagation()}>
            <div className="section-picker-title">Section color</div>
            <div className="section-picker-grid">
              {Object.entries(SECTION_SWATCHES).map(([key, c]) => (
                <button
                  key={key}
                  className="section-swatch"
                  style={{ background: c.bg, borderColor: c.stroke }}
                  onClick={() => placeFrame(key)}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Shapes */}
      <div className="shape-btn-wrap">
        <div className={`fj-split ${shapePickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${['geo', 'line'].includes(currentTool) ? 'active' : ''}`}
            onClick={() => setShape(lastShape)}
            onPointerDown={stopToolbarPointer}
            title="Shapes"
            type="button"
          >
            {(() => { const Icon = SHAPE_ICON_MAP[lastShape] || FjRectIcon; return <Icon /> })()}
          </button>
          <button
            className={`fj-tool fj-tool-caret ${shapePickerOpen ? 'active' : ''}`}
            onClick={() => { setShapePickerOpen(o => !o); setStickyPickerOpen(false); setSectionPickerOpen(false); setDrawPickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {shapePickerOpen && (
          <div className="shape-picker" onClick={e => e.stopPropagation()}>
            {GEO_SHAPES.map((s) => (
              <button key={s.id} className="shape-option" onClick={() => setShape(s.id)} title={s.id} type="button"><s.Icon /></button>
            ))}
            <div className="shape-picker-sep" />
            <button className="shape-option shape-option-line" onClick={() => setShape('line')} title="line" type="button"><FjLineIcon /></button>
          </div>
        )}
      </div>

      <button
        className={`fj-tool ${currentTool === 'text' ? 'active' : ''}`}
        onClick={() => setTool('text')}
        onPointerDown={stopToolbarPointer}
        title="Text"
        type="button"
      ><FjTextIcon /></button>

      <button
        className={`fj-tool ${currentTool === 'arrow' ? 'active' : ''}`}
        onClick={() => setTool('arrow')}
        onPointerDown={stopToolbarPointer}
        title="Connector"
        type="button"
      ><FjArrowIcon /></button>

      <div className="draw-btn-wrap">
        <div className={`fj-split ${drawPickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${currentTool === 'draw' ? 'active' : ''}`}
            onClick={activateDraw}
            onPointerDown={stopToolbarPointer}
            title="Draw"
            type="button"
          ><FjPenIcon /></button>
          <button
            className={`fj-tool fj-tool-caret ${drawPickerOpen ? 'active' : ''}`}
            onClick={() => { setDrawPickerOpen((open) => !open); setStickyPickerOpen(false); setSectionPickerOpen(false); setShapePickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
            title="Draw options"
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {drawPickerOpen && (
          <div className="tool-style-picker" onClick={(e) => e.stopPropagation()}>
            <div className="section-picker-title">Pen defaults</div>
            <div className="tool-style-row">
              <div className="tool-style-label">Color</div>
              {/* `data-color-context="permissive"` opts out of the per-mode
                  black/white disable rule in canvas.css. Pens often draw on
                  top of filled shapes, so the user always needs every color. */}
              <div className="tool-style-swatches" data-color-context="permissive">
                <button
                  className="tool-style-swatch"
                  onClick={setDrawColorAuto}
                  title="Auto (black on light canvas, white on dark)"
                  type="button"
                  data-swatch-id="auto"
                />
                {AURORA_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.id}
                    className={`tool-style-swatch ${lastDrawColor === swatch.tl ? 'active' : ''}`}
                    style={{ background: swatch.bg }}
                    onClick={() => setDrawColor(swatch.tl)}
                    title={swatch.id}
                    type="button"
                    data-swatch-id={swatch.id}
                  />
                ))}
              </div>
            </div>
            <div className="tool-style-row">
              <div className="tool-style-label">Stroke</div>
              <div className="tool-style-buttons">
                {STROKE_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={`tool-style-btn ${lastDrawDash === option.id ? 'active' : ''}`}
                    onClick={() => setDrawStroke(option.id)}
                    title={option.title}
                    type="button"
                  >
                    <TldrawUiButtonIcon small icon={option.icon} />
                  </button>
                ))}
              </div>
            </div>
            <div className="tool-style-row">
              <div className="tool-style-label">Size</div>
              <div className="tool-style-buttons">
                {SIZE_OPTIONS.map((size) => (
                  <button
                    key={size.id}
                    className={`tool-style-btn ${lastDrawSize === size.id ? 'active' : ''}`}
                    onClick={() => setDrawSize(size.id)}
                    type="button"
                  >{size.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Marker (highlight) */}
      <div className="marker-btn-wrap">
        <div className={`fj-split ${markerPickerOpen ? 'open' : ''}`}>
          <button
            className={`fj-tool fj-tool-main ${currentTool === 'highlight' ? 'active' : ''}`}
            onClick={() => activateMarker()}
            onPointerDown={stopToolbarPointer}
            title="Marker"
            type="button"
          ><FjMarkerIcon /></button>
          <button
            className={`fj-tool fj-tool-caret ${markerPickerOpen ? 'active' : ''}`}
            onClick={() => { setMarkerPickerOpen(o => !o); setStickyPickerOpen(false); setSectionPickerOpen(false); setShapePickerOpen(false); setDrawPickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {markerPickerOpen && (
          <div className="tool-style-picker" onClick={(e) => e.stopPropagation()}>
            <div className="section-picker-title">Marker defaults</div>
            <div className="tool-style-row">
              <div className="tool-style-label">Color</div>
              {/* HIGHLIGHT_SWATCHES (not AURORA_SWATCHES): tldraw's highlight
                  tool re-maps every color name to its `highlightSrgb` hex,
                  so the AURORA swatch hex was lying about what landed on
                  canvas (e.g. AURORA `black` rendered as yellow). The
                  swatch icons here are the actual rendered highlight hex.
                  `permissive` context: highlights frequently sit over
                  filled shapes, so all colors stay enabled in both modes. */}
              <div className="tool-style-swatches" data-color-context="permissive">
                {HIGHLIGHT_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.id}
                    className={`tool-style-swatch ${lastMarkerColor === swatch.tl ? 'active' : ''}`}
                    style={{
                      // Both light + dark hexes are exposed as custom props;
                      // the .tool-style-swatch[data-highlight-icon] CSS rule
                      // resolves which one renders per html[data-mode].
                      '--s8-highlight-bg': swatch.bg,
                      '--s8-highlight-bg-dark': swatch.bgDark,
                    }}
                    onClick={() => setMarkerColor(swatch.tl)}
                    title={swatch.id}
                    type="button"
                    data-swatch-id={swatch.id}
                    data-highlight-icon="true"
                  />
                ))}
              </div>
            </div>
            <div className="tool-style-row">
              <div className="tool-style-label">Size</div>
              <div className="tool-style-buttons">
                {SIZE_OPTIONS.map((size) => (
                  <button
                    key={size.id}
                    className={`tool-style-btn ${lastMarkerSize === size.id ? 'active' : ''}`}
                    onClick={() => setMarkerSize(size.id)}
                    type="button"
                  >{size.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedImage && (
        <>
          <div className="fj-sep" />
          <button
            className="fj-tool"
            onClick={replaceImage}
            onPointerDown={stopToolbarPointer}
            title="Replace image"
            type="button"
          ><TldrawUiButtonIcon small icon="tool-media" /></button>
          <button
            className={`fj-tool ${currentTool.startsWith('select.crop') ? 'active' : ''}`}
            onClick={startImageCrop}
            onPointerDown={stopToolbarPointer}
            title="Crop image"
            type="button"
          ><TldrawUiButtonIcon small icon="crop" /></button>
          <button
            className="fj-tool"
            onClick={expandImage}
            onPointerDown={stopToolbarPointer}
            title="View full size"
            type="button"
          ><TldrawUiButtonIcon small icon="zoom-in" /></button>
          <button
            className="fj-tool"
            onClick={downloadImage}
            onPointerDown={stopToolbarPointer}
            title="Download original"
            type="button"
          ><TldrawUiButtonIcon small icon="download" /></button>
          {editingAltText ? (
            <div
              className="fj-alt-wrap"
              onPointerDownCapture={stopToolbarPointer}
              onMouseDownCapture={stopToolbarPointer}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                className="fj-alt-input"
                value={altTextDraft}
                onChange={(e) => setAltTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAltText()
                  if (e.key === 'Escape') setEditingAltText(false)
                }}
                placeholder="Alt text"
              />
              <button
                className="fj-mini-btn"
                onClick={saveAltText}
                onPointerDown={stopToolbarPointer}
                title="Save alt text"
                type="button"
              ><TldrawUiButtonIcon small icon="check" /></button>
            </div>
          ) : (
            <button
              className={`fj-tool ${selectedImage.meta?.altText ? 'active' : ''}`}
              onClick={() => setEditingAltText(true)}
              onPointerDown={stopToolbarPointer}
              title="Edit alt text"
              type="button"
            ><span className="fj-alt-label">ALT</span></button>
          )}
        </>
      )}
    </div>
    </>
  )
})
