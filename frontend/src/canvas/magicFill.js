// Shared helpers for the "magic" auto-fill feature on geo shapes.
//
// A magic fill is one whose colour flips with the canvas mode — black on
// light, white on dark — matching the magic-stroke / magic-text / magic-note
// pattern. The sentinel below is stored in `shape.meta.fillColor` instead of
// a real hex; everything else (opacity, the DefaultFillStyle='solid' set, the
// data-geo-fill-custom DOM attribute) is shared with normal custom fills.

export const MAGIC_FILL = '__auto__'

export function resolveFillColor(fillColor, isDark) {
  if (fillColor === MAGIC_FILL) return isDark ? '#FFFFFF' : '#000000'
  return fillColor
}

// True when a shape carries a custom fill we own (the on-canvas CSS or the
// export-time toSvg override should kick in). Geo-only today; widen if any
// other shape type adopts the same meta convention.
export function hasCustomFill(shape) {
  return (
    shape?.type === 'geo' &&
    typeof shape?.meta?.fillColor === 'string' &&
    Number(shape?.meta?.fillOpacity) > 0
  )
}
