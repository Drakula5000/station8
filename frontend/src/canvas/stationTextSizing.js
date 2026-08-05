// One source of truth for the compact Station 8 text scale.
// Both on-canvas measurement and SVG export must use these values; tldraw's
// native 18/24/36/44px defaults are intentionally not used for text shapes.
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
