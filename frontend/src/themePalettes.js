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
const entry = (solid, noteFill, noteText, framePair) => ({
  solid,
  fill: solid,
  linedFill: solid,
  semi: noteFill,
  pattern: solid,
  noteFill,
  noteText,
  frameStroke: framePair[0],
  frameFill: 'transparent',
  frameHeadingStroke: framePair[0],
  frameHeadingFill: framePair[1],
  frameText: noteText,
  highlightSrgb: solid,
  highlightP3: solid,
})

// ─── I · Liquid Glass ─────────────────────────────────────────────────────
const GLASS = {
  black:         entry('#8891AD', '#1A1E30', '#F2F4FA', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  grey:          entry('#8891AD', '#5C6478', '#F2F4FA', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-violet':entry('#BC8CFF', '#E4D0FF', '#1B0A3A', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  violet:        entry('#BC8CFF', '#C8A8FF', '#1B0A3A', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  blue:          entry('#7CE6FF', '#8FD4FF', '#0A1E30', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-blue':  entry('#7CE6FF', '#BDE0F2', '#0A1E30', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  yellow:        entry('#F5DE7A', '#F5DE7A', '#221900', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  orange:        entry('#FFA77C', '#FFD4A8', '#281600', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  green:         entry('#9FE5C8', '#9FE5C8', '#0A241A', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-green': entry('#C2E3B5', '#C2E3B5', '#0F1F08', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  'light-red':   entry('#FF9FB8', '#FFC9D2', '#3A0A14', ['rgba(124,230,255,0.45)', '#0A0E1C']),
  red:           entry('#FF7A9E', '#FFB8C4', '#3A0A14', ['rgba(124,230,255,0.45)', '#0A0E1C']),
}

// ─── II · Command Deck (HUD) ─────────────────────────────────────────────
const HUD = {
  black:         entry('#F3E8CE', '#141411', '#F3E8CE', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  grey:          entry('#8A7A52', '#6B6455', '#F3E8CE', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-violet':entry('#E4B87A', '#E4B87A', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  violet:        entry('#D49A4E', '#D49A4E', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  blue:          entry('#5FE6D2', '#5FE6D2', '#042020', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-blue':  entry('#5FE6D2', '#8EEAD8', '#042020', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  yellow:        entry('#FFA528', '#F5A14F', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  orange:        entry('#FFA528', '#E87A2E', '#2A1400', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  green:         entry('#5FE6A5', '#5FE6A5', '#0A241A', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-green': entry('#7CEEB8', '#7CEEB8', '#0A241A', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  'light-red':   entry('#F07A5E', '#F07A5E', '#2A0404', ['rgba(255,165,40,0.55)', '#0A0A0C']),
  red:           entry('#E54B2C', '#E54B2C', '#F3E8CE', ['rgba(255,165,40,0.55)', '#0A0A0C']),
}

// ─── III · Abyss (bioluminescent jade + violet) ──────────────────────────
const ABYSS = {
  black:         entry('#D8EFE3', '#042018', '#D8EFE3', ['rgba(58,245,184,0.35)', '#031018']),
  grey:          entry('#7DA59F', '#4E6E6A', '#D8EFE3', ['rgba(58,245,184,0.35)', '#031018']),
  'light-violet':entry('#C4A0FF', '#C4A0FF', '#1B0A3A', ['rgba(58,245,184,0.35)', '#031018']),
  violet:        entry('#A07AFF', '#A07AFF', '#1B0A3A', ['rgba(58,245,184,0.35)', '#031018']),
  blue:          entry('#6DC4D8', '#6DC4D8', '#042020', ['rgba(58,245,184,0.35)', '#031018']),
  'light-blue':  entry('#8FE0EA', '#8FE0EA', '#042020', ['rgba(58,245,184,0.35)', '#031018']),
  yellow:        entry('#9FE88A', '#9FE88A', '#0F1F08', ['rgba(58,245,184,0.35)', '#031018']),
  orange:        entry('#7FD86E', '#7FD86E', '#0F1F08', ['rgba(58,245,184,0.35)', '#031018']),
  green:         entry('#3AF5B8', '#3AF5B8', '#042018', ['rgba(58,245,184,0.35)', '#031018']),
  'light-green': entry('#6FF5C8', '#6FF5C8', '#042018', ['rgba(58,245,184,0.35)', '#031018']),
  'light-red':   entry('#FFB0C4', '#FFB0C4', '#2A0A14', ['rgba(58,245,184,0.35)', '#031018']),
  red:           entry('#FF7AA3', '#FF7AA3', '#2A0A14', ['rgba(58,245,184,0.35)', '#031018']),
}

// ─── IV · Archive (brutalist cream + red) ────────────────────────────────
const ARCHIVE = {
  black:         entry('#EDE9DC', '#1A1816', '#EDE9DC', ['#2D2B24', '#0B0B0B']),
  grey:          entry('#8A8678', '#6B6860', '#EDE9DC', ['#2D2B24', '#0B0B0B']),
  'light-violet':entry('#E6E0EE', '#E6E0EE', '#1A1816', ['#2D2B24', '#0B0B0B']),
  violet:        entry('#D8D0E4', '#D8D0E4', '#1A1816', ['#2D2B24', '#0B0B0B']),
  blue:          entry('#D4DCE2', '#D4DCE2', '#1A1816', ['#2D2B24', '#0B0B0B']),
  'light-blue':  entry('#DEE4E9', '#DEE4E9', '#1A1816', ['#2D2B24', '#0B0B0B']),
  yellow:        entry('#EDE9DC', '#EDE9DC', '#1A1816', ['#2D2B24', '#0B0B0B']),
  orange:        entry('#DBC4B0', '#DBC4B0', '#1A1816', ['#2D2B24', '#0B0B0B']),
  green:         entry('#D6DCD2', '#D6DCD2', '#1A1816', ['#2D2B24', '#0B0B0B']),
  'light-green': entry('#E0E4DA', '#E0E4DA', '#1A1816', ['#2D2B24', '#0B0B0B']),
  'light-red':   entry('#E88E8E', '#E88E8E', '#0B0B0B', ['#2D2B24', '#0B0B0B']),
  red:           entry('#E04747', '#E04747', '#0B0B0B', ['#2D2B24', '#0B0B0B']),
}

// ─── V · Prisma (iridescent magenta + cyan) ──────────────────────────────
const PRISM = {
  black:         entry('#F0EAFF', '#0B0318', '#F0EAFF', ['rgba(255,92,224,0.55)', '#0B0318']),
  grey:          entry('#8F83B8', '#8080A8', '#F0EAFF', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-violet':entry('#E0C4FF', '#E0C4FF', '#1B0A3A', ['rgba(255,92,224,0.55)', '#0B0318']),
  violet:        entry('#C0A0FF', '#C0A0FF', '#1B0A3A', ['rgba(255,92,224,0.55)', '#0B0318']),
  blue:          entry('#60F0FF', '#60F0FF', '#042020', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-blue':  entry('#A0F0FF', '#A0F0FF', '#042020', ['rgba(255,92,224,0.55)', '#0B0318']),
  yellow:        entry('#FFE5A0', '#FFE5A0', '#2A1400', ['rgba(255,92,224,0.55)', '#0B0318']),
  orange:        entry('#FFB28A', '#FFB28A', '#2A1400', ['rgba(255,92,224,0.55)', '#0B0318']),
  green:         entry('#A0FFE0', '#A0FFE0', '#0A241A', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-green': entry('#C4FFE8', '#C4FFE8', '#0A241A', ['rgba(255,92,224,0.55)', '#0B0318']),
  'light-red':   entry('#FFB0E0', '#FFB0E0', '#0B0318', ['rgba(255,92,224,0.55)', '#0B0318']),
  red:           entry('#FF5CE0', '#FF5CE0', '#0B0318', ['rgba(255,92,224,0.55)', '#0B0318']),
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
