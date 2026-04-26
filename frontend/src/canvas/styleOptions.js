export const SIZE_OPTIONS = [
  { id: 's', label: 'S' },
  { id: 'm', label: 'M' },
  { id: 'l', label: 'L' },
  { id: 'xl', label: 'XL' },
]

export const STROKE_STYLE_OPTIONS = [
  { id: 'draw', label: 'Sketch', shortLabel: 'Sketch', title: 'Sketch stroke', icon: 'dash-draw' },
  { id: 'dashed', label: 'Dash', shortLabel: 'Dash', title: 'Dashed stroke', icon: 'dash-dashed' },
  { id: 'dotted', label: 'Dot', shortLabel: 'Dot', title: 'Dotted stroke', icon: 'dash-dotted' },
  { id: 'solid', label: 'Solid', shortLabel: 'Solid', title: 'Solid stroke', icon: 'dash-solid' },
]

export const SHAPES_WITH_STROKE_STYLE = new Set(['geo', 'arrow', 'line', 'draw'])

// Rectangle-class geos that support real corner radius (rendered via CSS
// border-radius + outline on the wrapper, see GeoCornerStyles in ShapeStyles).
// Other geo subtypes (diamond, triangle, ellipse, etc.) skip the row.
export const RECT_CLASS_GEOS = new Set(['rectangle', 'x-box', 'check-box'])
