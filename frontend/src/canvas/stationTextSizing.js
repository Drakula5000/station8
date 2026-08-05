// One source of truth for the compact Station 8 text scale.
// Canvas measurement, typing updates, and SVG export must all use these
// values; tldraw's native 18/24/36/44px defaults are intentionally not used
// for Station text shapes.
export const STATION_TEXT_FONT_SIZES = Object.freeze({ s: 8, m: 12, l: 16, xl: 22 })

export function getStationTextFontSize(size) {
  return STATION_TEXT_FONT_SIZES[size] ?? STATION_TEXT_FONT_SIZES.s
}

export function getStationTextExportMetrics(props, bounds) {
  const scale = props.scale || 1
  return {
    fontSize: getStationTextFontSize(props.size),
    width: bounds.width / scale,
    height: bounds.height / scale,
  }
}

// Match tldraw's anchoring rules, but operate only on dimensions measured
// with Station's compact font scale. For centered text, width growth moves the
// shape's x coordinate left by half the real growth so its visual center stays
// fixed. The previous inherited implementation mixed Station measurements
// with tldraw's much larger defaults, causing the shape to race left while the
// user typed.
export function getStationTextAnchorDelta(textAlign, textDidChange, before, after) {
  const widthDelta = after.width - before.width
  const verticalDelta = textDidChange ? 0 : (after.height - before.height) / 2

  switch (textAlign) {
    case 'middle':
      return { x: widthDelta / 2, y: verticalDelta }
    case 'end':
      return { x: widthDelta, y: verticalDelta }
    default:
      return textDidChange ? null : { x: 0, y: verticalDelta }
  }
}
