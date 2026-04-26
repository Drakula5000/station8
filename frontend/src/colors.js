// Aurora swatch palette — single source of truth.
// `bg` references CSS custom properties so all hex values live in App.css.
// `tl` is the tldraw color name stored on the shape and used by the
// data-tl-color CSS hooks.
export const AURORA_SWATCHES = [
  { id: 'black',    bg: 'var(--s8-tl-black)',    tl: 'black' },
  { id: 'white',    bg: 'var(--s8-tl-white)',    tl: 'white' },
  { id: 'lavender', bg: 'var(--s8-tl-lavender)', tl: 'light-violet' },
  { id: 'pink',     bg: 'var(--s8-tl-pink)',     tl: 'light-red' },
  { id: 'blue',     bg: 'var(--s8-tl-blue)',     tl: 'light-blue' },
  { id: 'teal',     bg: 'var(--s8-tl-teal)',     tl: 'light-green' },
  { id: 'orange',   bg: 'var(--s8-tl-orange)',   tl: 'orange' },
  { id: 'purple',   bg: 'var(--s8-tl-violet)',   tl: 'violet' },
  { id: 'red',      bg: 'var(--s8-tl-pink-strong)', tl: 'red' },
  { id: 'grey',     bg: 'var(--s8-tl-grey)',     tl: 'grey' },
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
