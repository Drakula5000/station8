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

// Highlighter palette — DOES NOT match the AURORA palette. tldraw's highlight
// tool re-maps every color name to a fluorescent variant (`highlightSrgb` in
// `@tldraw/tlschema/styles/TLColorStyle.js`), so picking the `black` AURORA
// swatch lands a yellow highlight on canvas and `light-violet` lands hot pink.
// To keep the picker truthful (icon = what lands), the swatches below are the
// tldraw highlightSrgb hex values themselves. Light-mode srgb is used for the
// icon (more saturated, more recognisable) — the actual rendered highlight
// will dim in dark mode automatically (tldraw uses the dark-mode srgb at draw
// time).
//
// `tl` is the tldraw color NAME that gets written to props.color.
// `bg` is the LIGHT-mode hex of that name's highlightSrgb — what the user
//   sees in the icon.
// `bgDark` is the DARK-mode hex (used by the icon CSS to mode-adapt).
//
// Curation notes:
//   - `black` is dropped: tldraw renders it as yellow, so it duplicated the
//     `yellow` swatch.
//   - `red` (coral #ff636e) is dropped: too close to `light-red` (salmon
//     #ff7fa3) at highlighter saturation.
//   - `white` is added so users can highlight on dark canvases.
//   - `grey` is dropped: low-saturation grey is a poor highlighter.
export const HIGHLIGHT_SWATCHES = [
  { id: 'yellow',     tl: 'yellow',        bg: '#fddd00', bgDark: '#d2b700' },
  { id: 'orange',     tl: 'orange',        bg: '#ffa500', bgDark: '#d07a00' },
  { id: 'salmon',     tl: 'light-red',     bg: '#ff7fa3', bgDark: '#db005b' },
  { id: 'hot-pink',   tl: 'light-violet',  bg: '#ff88ff', bgDark: '#c400c7' },
  { id: 'purple',     tl: 'violet',        bg: '#c77cff', bgDark: '#9e00ee' },
  { id: 'cyan',       tl: 'light-blue',    bg: '#00f4ff', bgDark: '#00bdc8' },
  { id: 'sky-blue',   tl: 'blue',          bg: '#10acff', bgDark: '#0079d2' },
  { id: 'lime',       tl: 'light-green',   bg: '#65f641', bgDark: '#00a000' },
  { id: 'mint',       tl: 'green',         bg: '#00ffc8', bgDark: '#009774' },
  { id: 'white',      tl: 'white',         bg: '#ffffff', bgDark: '#ffffff' },
]
