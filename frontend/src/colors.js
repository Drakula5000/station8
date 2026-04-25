// Aurora swatch palette — single source of truth.
// `bg` is what the swatch chip displays and what lands on canvas (after the
// CSS data-tl-color overrides in App.css). `tl` is the tldraw color name
// stored on the shape and used by the data-tl-color CSS hooks.
//
// If you change a hex here, also update the matching `[data-tl-color='<tl>']`
// override in App.css so the CSS-rendered fill matches the picker chip.
export const AURORA_SWATCHES = [
  { id: 'black',    bg: '#000000', tl: 'black' },
  { id: 'white',    bg: '#FFFFFF', tl: 'white' },
  { id: 'lavender', bg: '#C8B0F5', tl: 'light-violet' },
  { id: 'pink',     bg: '#F0A8C0', tl: 'light-red' },
  { id: 'blue',     bg: '#90BCE8', tl: 'light-blue' },
  { id: 'teal',     bg: '#88D4B0', tl: 'light-green' },
  { id: 'orange',   bg: '#F0B880', tl: 'orange' },
  { id: 'purple',   bg: '#B8A0F8', tl: 'violet' },
  { id: 'red',      bg: '#e87890', tl: 'red' },
  { id: 'grey',     bg: '#8898b0', tl: 'grey' },
]

// Sticky-note picker uses legacy keys (yellow/pink/blue/green/orange/purple)
// stored on existing shapes; map each to the corresponding master swatch.
const STICKY_KEY_TO_ID = {
  yellow: 'lavender',
  pink:   'pink',
  blue:   'blue',
  green:  'teal',
  orange: 'orange',
  purple: 'purple',
}

const swatchById = Object.fromEntries(AURORA_SWATCHES.map((s) => [s.id, s]))

export const STICKY_SWATCHES = Object.fromEntries(
  Object.entries(STICKY_KEY_TO_ID).map(([key, id]) => [key, { bg: swatchById[id].bg, tl: swatchById[id].tl }])
)
