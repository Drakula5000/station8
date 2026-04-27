import {
  TextShapeUtil,
  FONT_FAMILIES,
  TEXT_PROPS,
  renderHtmlFromRichTextForMeasurement,
} from 'tldraw'

// Station-specific text-shape font sizes — much smaller than tldraw's
// defaults (s:18, m:24, l:36, xl:44), which feel oversized on a research
// canvas where text shapes are usually annotation labels next to other
// content. The 's' default produces a compact ~8px label.
const STATION_TEXT_FONT_SIZES = { s: 8, m: 12, l: 16, xl: 22 }

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
export class StationTextShapeUtil extends TextShapeUtil {
  getMinDimensions(shape) {
    return computeStationTextSize(this.editor, shape.props)
  }
}

function computeStationTextSize(editor, props) {
  const { font, richText, size, w, autoSize } = props
  const fontSize = STATION_TEXT_FONT_SIZES[size] ?? STATION_TEXT_FONT_SIZES.s
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
