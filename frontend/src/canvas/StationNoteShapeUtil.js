import {
  NoteShapeUtil,
  FONT_FAMILIES,
  TEXT_PROPS,
  isEqual,
  renderHtmlFromRichTextForMeasurement,
  renderPlaintextFromRichText,
} from 'tldraw'

// Mirror of tldraw internals. Both are `@internal` but stable — tldraw
// can't change them without breaking every existing note in any consumer's
// persisted snapshot.
const NOTE_SIZE = 200
const LABEL_PADDING = 16
const FUZZ = 1

// Station-specific font sizes — much smaller than tldraw's defaults
// (s:18, m:22, l:26, xl:32), which feel oversized on a 200px note. Our
// sizes let a note hold a useful amount of text at the default 's' without
// auto-shrinking kicking in. The auto-shrink floor is s (8px); notes that
// overflow even at s stay at s and clip rather than grow.
const STATION_LABEL_FONT_SIZES = { s: 8, m: 12, l: 16, xl: 22 }

// Custom NoteShapeUtil: a sticky note never grows. When its text would
// overflow, we shrink the font instead — matching the "post-it" intuition
// (you write smaller when you run out of room, you don't tear the paper bigger).
//
// Stock tldraw: `getNoteSizeAdjustments` bumps `growY` so the container
// expands vertically; font only shrinks for width-fit. We clamp `growY = 0`
// and binary-step fontSizeAdjustment down until both dimensions fit.
//
// We always return a positive fontSizeAdjustment (never 0) so tldraw uses
// our STATION_LABEL_FONT_SIZES instead of its own larger defaults.
export class StationNoteShapeUtil extends NoteShapeUtil {
  onBeforeCreate(next) {
    return getStationNoteSizeAdjustments(this.editor, next)
  }

  onBeforeUpdate(prev, next) {
    if (
      isEqual(prev.props.richText, next.props.richText) &&
      prev.props.font === next.props.font &&
      prev.props.size === next.props.size
    ) {
      return undefined
    }
    return getStationNoteSizeAdjustments(this.editor, next)
  }
}

function isRichTextEmpty(editor, richText) {
  if (!richText) return true
  try {
    const plain = renderPlaintextFromRichText(editor, richText)
    return !plain || !plain.trim()
  } catch {
    return false
  }
}

function getStationNoteSizeAdjustments(editor, shape) {
  const fontSizeAdjustment = computeFitFontSize(editor, shape)
  const growY = 0
  if (
    growY === shape.props.growY &&
    fontSizeAdjustment === shape.props.fontSizeAdjustment
  ) {
    return undefined
  }
  return {
    ...shape,
    props: {
      ...shape.props,
      growY,
      fontSizeAdjustment,
    },
  }
}

function computeFitFontSize(editor, shape) {
  const { richText, font, size } = shape.props
  const baseFontSize = STATION_LABEL_FONT_SIZES[size] ?? 8

  // Empty note: return our base size so tldraw renders the placeholder
  // at our size (not its own larger default which kicks in when
  // fontSizeAdjustment === 0).
  if (isRichTextEmpty(editor, richText)) return baseFontSize

  const maxWidth = NOTE_SIZE - LABEL_PADDING * 2 - FUZZ
  const maxHeight = NOTE_SIZE - LABEL_PADDING * 2

  // Walk down from our base until both width AND height fit.
  let fontSize = baseFontSize
  for (let i = 0; i < 60; i++) {
    const html = renderHtmlFromRichTextForMeasurement(editor, richText)
    const measure = editor.textMeasure.measureHtml(html, {
      ...TEXT_PROPS,
      fontFamily: FONT_FAMILIES[font],
      fontSize,
      maxWidth,
    })
    if (measure.h <= maxHeight && measure.w <= maxWidth + FUZZ) {
      return fontSize
    }
    fontSize -= 1
    if (fontSize < STATION_LABEL_FONT_SIZES.s) {
      return STATION_LABEL_FONT_SIZES.s
    }
  }
  return Math.max(STATION_LABEL_FONT_SIZES.s, fontSize)
}
