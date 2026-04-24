/**
 * Per-board theme palettes for tldraw.
 *
 * tldraw's color palette is hardcoded in @tldraw/tlschema as a plain object
 * (DefaultColorThemePalette). The official customization path is to MUTATE
 * this object before shapes render — shapes read palette values via the
 * `useDefaultColorTheme()` hook at render time, so mutating the object then
 * forcing a re-render of <Tldraw> (via a `key` that changes on theme swap)
 * makes the new colors take effect cleanly.
 *
 * Docs: https://tldraw.dev/examples/changing-default-colors
 * Source: node_modules/@tldraw/tlschema/dist-esm/styles/TLColorStyle.mjs
 */

import { DefaultColorThemePalette } from 'tldraw'

// Snapshot original palette so Aurora can restore defaults.
const originalDark  = JSON.parse(JSON.stringify(DefaultColorThemePalette.darkMode))
const originalLight = JSON.parse(JSON.stringify(DefaultColorThemePalette.lightMode))

/**
 * Build a per-color palette entry from four values we actually paint with:
 *   solid     — arrows, lines, draws, text, geo stroke
 *   noteFill  — sticky background
 *   noteText  — sticky text
 *   framePair — [stroke, headingFill] (we also reuse stroke for heading stroke)
 *
 * Everything else (linedFill, pattern, semi, highlight) we leave as tldraw
 * defaults since those are rarely seen. frameFill stays transparent so the
 * canvas background shows through every frame.
 */
/**
 * Safe-only palette override: we ONLY touch fields that control decorative
 * surfaces (sticky bg/text, frame stroke/fill/heading). We deliberately do
 * NOT touch `solid`, `fill`, or `linedFill` because those are the exact
 * fields tldraw uses to paint:
 *   - text shape color          (shape.props.color → fill)
 *   - arrow stroke
 *   - line stroke
 *   - draw (pen) stroke
 *   - geo outline / fill
 * Remapping them risks making user-authored content invisible against the
 * theme's dark bg. tldraw's darkMode defaults already guarantee content
 * readability — leave them be.
 */
const entry = (noteFill, noteText, framePair) => ({
  noteFill,
  noteText,
  frameStroke: framePair[0],
  frameFill: 'transparent',
  frameHeadingStroke: framePair[0],
  frameHeadingFill: framePair[1],
  frameText: noteText,
})

// ─── I · Liquid Glass ─────────────────────────────────────────────────────
const GLASS = {
  black:         entry('#1A1E30', '#F2F4FA', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  grey:          entry('#5C6478', '#F2F4FA', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-violet':entry('#E4D0FF', '#1B0A3A', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  violet:        entry('#C8A8FF', '#1B0A3A', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  blue:          entry('#8FD4FF', '#0A1E30', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-blue':  entry('#BDE0F2', '#0A1E30', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  yellow:        entry('#F5DE7A', '#221900', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  orange:        entry('#FFD4A8', '#281600', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  green:         entry('#9FE5C8', '#0A241A', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-green': entry('#C2E3B5', '#0F1F08', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-red':   entry('#FFC9D2', '#3A0A14', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  red:           entry('#FFB8C4', '#3A0A14', ['rgba(124,230,255,0.45)', '#0A0E1C']),
}

// ─── II · Command Deck (HUD) ─────────────────────────────────────────────
const HUD = {
  black:         entry('#141411', '#F3E8CE', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  grey:          entry('#6B6455', '#F3E8CE', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-violet':entry('#E4B87A', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  violet:        entry('#D49A4E', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  blue:          entry('#5FE6D2', '#042020', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-blue':  entry('#8EEAD8', '#042020', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  yellow:        entry('#F5A14F', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  orange:        entry('#E87A2E', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  green:         entry('#5FE6A5', '#0A241A', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-green': entry('#7CEEB8', '#0A241A', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-red':   entry('#F07A5E', '#2A0404', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  red:           entry('#E54B2C', '#F3E8CE', ['rgba(255,165,40,0.55)', '#0A0A0C']),
}

// ─── III · Abyss (bioluminescent jade + violet) ──────────────────────────
const ABYSS = {
  black:         entry('#042018', '#D8EFE3', ['rgba(58,245,184,0.35)', '#031018']),
  grey:          entry('#4E6E6A', '#D8EFE3', ['rgba(58,245,184,0.35)', '#031018']),
  'light-violet':entry('#C4A0FF', '#1B0A3A', ['rgba(58,245,184,0.35)', '#031018']),
  violet:        entry('#A07AFF', '#1B0A3A', ['rgba(58,245,184,0.35)', '#031018']),
  blue:          entry('#6DC4D8', '#042020', ['rgba(58,245,184,0.35)', '#031018']),
  'light-blue':  entry('#8FE0EA', '#042020', ['rgba(58,245,184,0.35)', '#031018']),
  yellow:        entry('#9FE88A', '#0F1F08', ['rgba(58,245,184,0.35)', '#031018']),
  orange:        entry('#7FD86E', '#0F1F08', ['rgba(58,245,184,0.35)', '#031018']),
  green:         entry('#3AF5B8', '#042018', ['rgba(58,245,184,0.35)', '#031018']),
  'light-green': entry('#6FF5C8', '#042018', ['rgba(58,245,184,0.35)', '#031018']),
  'light-red':   entry('#FFB0C4', '#2A0A14', ['rgba(58,245,184,0.35)', '#031018']),
  red:           entry('#FF7AA3', '#2A0A14', ['rgba(58,245,184,0.35)', '#031018']),
}

// ─── IV · Archive (brutalist cream + red) ────────────────────────────────
const ARCHIVE = {
  black:         entry('#1A1816', '#EDE9DC', ['#2D2B24', '#0B0B0B']),
  grey:          entry('#6B6860', '#EDE9DC', ['#2D2B24', '#0B0B0B']),
  'light-violet':entry('#E6E0EE', '#1A1816', ['#2D2B24', '#0B0B0B']),
  violet:        entry('#D8D0E4', '#1A1816', ['#2D2B24', '#0B0B0B']),
  blue:          entry('#D4DCE2', '#1A1816', ['#2D2B24', '#0B0B0B']),
  'light-blue':  entry('#DEE4E9', '#1A1816', ['#2D2B24', '#0B0B0B']),
  yellow:        entry('#EDE9DC', '#1A1816', ['#2D2B24', '#0B0B0B']),
  orange:        entry('#DBC4B0', '#1A1816', ['#2D2B24', '#0B0B0B']),
  green:         entry('#D6DCD2', '#1A1816', ['#2D2B24', '#0B0B0B']),
  'light-green': entry('#E0E4DA', '#1A1816', ['#2D2B24', '#0B0B0B']),
  'light-red':   entry('#E88E8E', '#0B0B0B', ['#2D2B24', '#0B0B0B']),
  red:           entry('#E04747', '#0B0B0B', ['#2D2B24', '#0B0B0B']),
}

// ─── V · Prisma (iridescent magenta + cyan) ──────────────────────────────
const PRISM = {
  black:         entry('#0B0318', '#F0EAFF', ['rgba(255,92,224,0.55)', '#0B0318']),
  grey:          entry('#8080A8', '#F0EAFF', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-violet':entry('#E0C4FF', '#1B0A3A', ['rgba(255,92,224,0.55)', '#0B0318']),
  violet:        entry('#C0A0FF', '#1B0A3A', ['rgba(255,92,224,0.55)', '#0B0318']),
  blue:          entry('#60F0FF', '#042020', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-blue':  entry('#A0F0FF', '#042020', ['rgba(255,92,224,0.55)', '#0B0318']),
  yellow:        entry('#FFE5A0', '#2A1400', ['rgba(255,92,224,0.55)', '#0B0318']),
  orange:        entry('#FFB28A', '#2A1400', ['rgba(255,92,224,0.55)', '#0B0318']),
  green:         entry('#A0FFE0', '#0A241A', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-green': entry('#C4FFE8', '#0A241A', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-red':   entry('#FFB0E0', '#0B0318', ['rgba(255,92,224,0.55)', '#0B0318']),
  red:           entry('#FF5CE0', '#0B0318', ['rgba(255,92,224,0.55)', '#0B0318']),
}

const PALETTES = { glass: GLASS, hud: HUD, abyss: ABYSS, archive: ARCHIVE, prism: PRISM }

/**
 * Mutate the global tldraw palette to match the given theme. Call this BEFORE
 * forcing a <Tldraw> re-mount so shapes pick up the new hex values on next render.
 *
 * Passing 'aurora' (or null/undefined) restores tldraw's factory defaults.
 */
export function applyTldrawPalette(themeId) {
  if (!themeId || themeId === 'aurora') {
    Object.assign(DefaultColorThemePalette.darkMode, JSON.parse(JSON.stringify(originalDark)))
    Object.assign(DefaultColorThemePalette.lightMode, JSON.parse(JSON.stringify(originalLight)))
    return
  }
  const overrides = PALETTES[themeId]
  if (!overrides) return
  // Always reset to factory before applying, so switching themes never
  // accumulates stale values from the previous theme.
  Object.assign(DefaultColorThemePalette.darkMode, JSON.parse(JSON.stringify(originalDark)))
  Object.assign(DefaultColorThemePalette.lightMode, JSON.parse(JSON.stringify(originalLight)))
  for (const [colorName, overrideEntry] of Object.entries(overrides)) {
    Object.assign(DefaultColorThemePalette.darkMode[colorName], overrideEntry)
    Object.assign(DefaultColorThemePalette.lightMode[colorName], overrideEntry)
  }
}
