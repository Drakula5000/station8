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
import { getStationTextExportMetrics, getStationTextFontSize } from './stationTextSizing'

const MIN_WIDTH = 16

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
    const bounds = this.editor.getShapeGeometry(shape).bounds
    const metrics = getStationTextExportMetrics(shape.props, bounds)
    const exportBounds = new Box(0, 0, metrics.width, metrics.height)
    const theme = getDefaultColorTheme(ctx)

    return createElement(RichTextSVG, {
      fontSize: metrics.fontSize,
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
