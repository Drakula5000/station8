import { useState, useEffect } from 'react'
import {
  track, useEditor,
  DefaultColorStyle, DefaultDashStyle, GeoShapeGeoStyle,
  TldrawUiButtonIcon,
} from 'tldraw'
import {
  FjCursorIcon, FjHandIcon, FjStickyIcon, FjTextIcon, FjArrowIcon, FjPenIcon, FjSectionIcon,
  FjEllipseIcon, FjDiamondIcon, FjRectIcon, FjLineIcon, FjChevronDownIcon,
} from '../icons'
import { STICKY_SWATCHES } from '../colors'
import { resolveImageShapeUrl } from './shared'

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

export const FjToolbar = track(function FjToolbar({ toolInfoRef, onOpenLightbox }) {
  const editor = useEditor()
  const [stickyPickerOpen, setStickyPickerOpen] = useState(false)
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false)
  const [shapePickerOpen, setShapePickerOpen] = useState(false)
  const [editingAltText, setEditingAltText] = useState(false)
  const [altTextDraft, setAltTextDraft] = useState('')
  const [lastStickyColor, setLastStickyColor] = useState('yellow')
  const [lastSectionColor, setLastSectionColor] = useState('violet')
  const [lastShape, setLastShape] = useState('ellipse')

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
    const onClick = (e) => {
      if (!e.target.closest('.sticky-btn-wrap')) setStickyPickerOpen(false)
      if (!e.target.closest('.section-btn-wrap')) setSectionPickerOpen(false)
      if (!e.target.closest('.shape-btn-wrap')) setShapePickerOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setStickyPickerOpen(false)
        setSectionPickerOpen(false)
        setShapePickerOpen(false)
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

  const placeNote = (color) => {
    setLastStickyColor(color)
    if (toolInfoRef) toolInfoRef.current.stickyColor = color
    try { editor.setStyleForNextShapes(DefaultColorStyle, STICKY_SWATCHES[color]?.tl || 'yellow') } catch { /* no-op */ }
    editor.setCurrentTool('note')
    setStickyPickerOpen(false)
  }

  const placeFrame = (color) => {
    setLastSectionColor(color)
    try { editor.setStyleForNextShapes(DefaultColorStyle, SECTION_SWATCHES[color]?.tl || 'blue') } catch { /* no-op */ }
    editor.setCurrentTool('frame')
    setSectionPickerOpen(false)
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
            onClick={() => { setStickyPickerOpen(o => !o); setSectionPickerOpen(false); setShapePickerOpen(false) }}
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
            onClick={() => { setSectionPickerOpen(o => !o); setStickyPickerOpen(false); setShapePickerOpen(false) }}
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
            {lastShape === 'diamond' ? <FjDiamondIcon />
              : lastShape === 'rectangle' ? <FjRectIcon />
              : lastShape === 'line' ? <FjLineIcon />
              : <FjEllipseIcon />}
          </button>
          <button
            className={`fj-tool fj-tool-caret ${shapePickerOpen ? 'active' : ''}`}
            onClick={() => { setShapePickerOpen(o => !o); setStickyPickerOpen(false); setSectionPickerOpen(false) }}
            onPointerDown={stopToolbarPointer}
            type="button"
          ><FjChevronDownIcon /></button>
        </div>
        {shapePickerOpen && (
          <div className="shape-picker" onClick={e => e.stopPropagation()}>
            <button className="shape-option" onClick={() => setShape('rectangle')} type="button"><FjRectIcon /></button>
            <button className="shape-option" onClick={() => setShape('ellipse')} type="button"><FjEllipseIcon /></button>
            <button className="shape-option" onClick={() => setShape('diamond')} type="button"><FjDiamondIcon /></button>
            <button className="shape-option" onClick={() => setShape('line')} type="button"><FjLineIcon /></button>
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

      <button
        className={`fj-tool ${currentTool === 'draw' ? 'active' : ''}`}
        onClick={() => setTool('draw')}
        onPointerDown={stopToolbarPointer}
        title="Draw"
        type="button"
      ><FjPenIcon /></button>

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
