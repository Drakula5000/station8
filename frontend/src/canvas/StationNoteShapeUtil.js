import { createElement, Fragment } from 'react'
import {
  NoteShapeUtil,
  LABEL_FONT_SIZES,
  RichTextSVG,
} from 'tldraw'

// Mirror of tldraw internals (NoteShapeUtil's noteHelpers + default-shape-constants).
// Both are `@internal` so we can't import them — but they're load-bearing
// constants tldraw itself relies on, and changing them upstream would break
// every existing note in any tldraw app, so they're effectively stable.
const NOTE_SIZE = 200
const LABEL_PADDING = 16

// Keep tldraw's native note sizing lifecycle. It grows a note vertically
// when the label needs more room, which handles pasted blocks just as
// reliably as typed text. This class remains in place for Station 8's
// mode-aware sticky export below.
export class StationNoteShapeUtil extends NoteShapeUtil {
  // Magic / auto-color export. The on-canvas DOM honours mode-aware CSS
  // in tldraw.css, but exports go through editor.toImage which renders
  // shapes via toSvg using tldraw's static color theme — for props.color
  // 'black' that's #FCE19C (yellow!) in light and #2c2c2c (dark grey) in
  // dark, neither of which matches what the user sees on canvas. Replace
  // with our flipped pair: black bg + white text in light, white bg +
  // black text in dark. Notes can grow vertically, so the export mirrors the
  // same height the user sees on canvas.
  toSvg(shape, ctx) {
    if (!shape.meta?.autoColor) return super.toSvg(shape, ctx)
    const noteFill = ctx.isDarkMode ? '#FFFFFF' : '#000000'
    const labelColor = ctx.isDarkMode ? '#000000' : '#FFFFFF'
    const height = NOTE_SIZE + shape.props.growY
    const bounds = { x: 0, y: 0, w: NOTE_SIZE, h: height }
    return createElement(
      Fragment,
      null,
      createElement('rect', {
        rx: 1,
        width: NOTE_SIZE,
        height,
        fill: noteFill,
      }),
      createElement(RichTextSVG, {
        fontSize: shape.props.fontSizeAdjustment || LABEL_FONT_SIZES[shape.props.size],
        font: shape.props.font,
        align: shape.props.align,
        verticalAlign: shape.props.verticalAlign,
        richText: shape.props.richText,
        labelColor,
        bounds,
        padding: LABEL_PADDING,
        showTextOutline: false,
      })
    )
  }
}
