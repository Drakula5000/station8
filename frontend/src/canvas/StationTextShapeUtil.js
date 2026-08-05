import { createElement } from 'react'
import {
  Box,
  TextShapeUtil,
  FONT_FAMILIES,
  TEXT_PROPS,
  RichTextSVG,
  getColorValue,
  getDefaultColorTheme,
  renderHtmlFromRichTextForMeasurement,
} from 'tldraw'

// Station-specific text-shape font sizes — much smaller than tldraw's
// defaults (s:18, m:24, l:36, xl:44), which feel oversized on a research
// canvas where text shapes are usually annotation labels next to other
// content. The 's' default produces a compact ~8px label.
export const STATION_TEXT_FONT_SIZES = Object.freeze({ s: 8, m: 12, l: 16, xl: 22 })

const MIN_WIDTH = 16

export function getStationTextFontSize(size) {
  return STATION_TEXT_FONT_SIZES[size] ?? STATION_TEXT_FONT_SIZES.s
}

// We override `getMinDimensions` so the bounding box is sized for our
// smaller font; the actual rendered font-size is overridden via CSS in
// tldraw.css (the `[data-shape-type='text'][data-s8-size]` block). Both
// have to agree or the box won't match the visible text.
//
// We do NOT override `component()` — replicating it would require tldraw
// internals that aren't exported (e.g. useTextShapeKeydownHandler). The
// CSS-based font-size override is enough because tldraw's component reads
// width/height from `getMinDimensions` (which we control) and font-size
// from `FONT_SIZES[size]` (which we re-point at the DOM via CSS).
//
// Export is a separate renderer. TextShapeUtil.toSvg uses tldraw's default
// 18/24/36/44px table, so inheriting it makes Station 8 text rewrap and
// overflow its Station-sized bounds. Override toSvg at the shape-util level
// so every export path — PNG, SVG, copy, selection, and whole page — uses
// the exact same font-size table as the canvas.
export class StationTextShapeUtil extends TextShapeUtil {
  getMinDimensions(shape) {
    return computeStationTextSize(this.editor, shape.props)
  }

  toSvg(shape, ctx) {
    const scale = shape.props.scale || 1
    const bounds = this.editor.getShapeGeometry(shape).bounds
    const exportBounds = new Box(0, 0, bounds.width / scale, bounds.height / scale)
    const theme = getDefaultColorTheme(ctx)

    return createElement(RichTextSVG, {
      fontSize: getStationTextFontSize(shape.props.size),
      font: shape.props.font,
      align: shape.props.textAlign,
      verticalAlign: 'middle',
      richText: shape.props.richText,
      labelColor: getColorValue(theme, shape.props.color, 'solid'),
      bounds: exportBounds,
      padding: 0,
      showTextOutline: this.options.showTextOutline,
    })
  }
}

function computeStationTextSize(editor, props) {
  const { font, richText, size, w, autoSize } = props
  const fontSize = getStationTextFontSize(size)
  const maybeFixedWidth = autoSize ? null : Math.max(MIN_WIDTH, Math.floor(w))

  const html = renderHtmlFromRichTextForMeasurement(editor, richText)
  const result = editor.textMeasure.measureHtml(html, {
    ...TEXT_PROPS,
    fontFamily: FONT_FAMILIES[font],
    fontSize,
    maxWidth: maybeFixedWidth,
  })

  return {
    width: maybeFixedWidth ?? Math.max(MIN_WIDTH, result.w + 1),
    height: Math.max(fontSize, result.h),
  }
}
