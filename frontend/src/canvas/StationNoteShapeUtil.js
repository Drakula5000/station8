import {
  NoteShapeUtil,
  FONT_FAMILIES,
  LABEL_FONT_SIZES,
  TEXT_PROPS,
  isEqual,
  renderHtmlFromRichTextForMeasurement,
  renderPlaintextFromRichText,
} from 'tldraw'

// Mirror of tldraw internals (NoteShapeUtil's noteHelpers + default-shape-constants).
// Both are `@internal` so we can't import them — but they're load-bearing
// constants tldraw itself relies on, and changing them upstream would break
// every existing note in any tldraw app, so they're effectively stable.
const NOTE_SIZE = 200
const LABEL_PADDING = 16
const FUZZ = 1
const MIN_FONT_SIZE = 8

// Custom NoteShapeUtil: a sticky note never grows. When its text would
// overflow, we shrink the font instead — matching the "post-it" intuition
// the user described (boxed paper square, you write smaller when you run out
// of room, you don't tear the paper bigger).
//
// Stock tldraw behavior: `getNoteSizeAdjustments` measures the rendered
// label and bumps `growY` so the container expands vertically; font only
// shrinks for width-fit. We override both lifecycle hooks to clamp
// `growY = 0` and binary-search a fontSizeAdjustment that fits BOTH
// dimensions.
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
  if (isRichTextEmpty(editor, richText)) return 0

  const baseFontSize = LABEL_FONT_SIZES[size]
  const maxWidth = NOTE_SIZE - LABEL_PADDING * 2 - FUZZ
  const maxHeight = NOTE_SIZE - LABEL_PADDING * 2

  // Walk down from the base size until both width AND height fit. tldraw's
  // own width-fit loop can't shrink past 14 (it falls back to overflow-wrap
  // break-word), but we need to keep going below that to satisfy the
  // height constraint as well.
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
      // Fits in both axes. fontSize = baseFontSize means "no adjustment"
      // (tldraw treats fontSizeAdjustment === 0 as the default size).
      return fontSize === baseFontSize ? 0 : fontSize
    }
    fontSize -= 1
    if (fontSize < MIN_FONT_SIZE) {
      return MIN_FONT_SIZE
    }
  }
  return Math.max(MIN_FONT_SIZE, fontSize)
}
