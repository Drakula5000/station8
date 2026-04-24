/**
 * Aurora is the only theme. This module exists to restore tldraw's default
 * palette (which Aurora relies on) and to provide a no-op applyTldrawPalette
 * for any call sites that still reference it.
 */

import { DefaultColorThemePalette } from 'tldraw'

// Snapshot original palette so Aurora can restore defaults if ever needed.
const originalDark  = JSON.parse(JSON.stringify(DefaultColorThemePalette.darkMode))
const originalLight = JSON.parse(JSON.stringify(DefaultColorThemePalette.lightMode))

/**
 * Aurora uses tldraw's factory defaults — just restore them.
 * The themeId parameter is kept for call-site compatibility but ignored.
 */
export function applyTldrawPalette(_themeId) {
  Object.assign(DefaultColorThemePalette.darkMode, JSON.parse(JSON.stringify(originalDark)))
  Object.assign(DefaultColorThemePalette.lightMode, JSON.parse(JSON.stringify(originalLight)))
}
