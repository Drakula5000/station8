/**
 * Per-theme canvas overlays: corner decorations, scanlines, readouts, rules,
 * stamps, caustic SVGs — anything that needs real DOM (not just CSS tokens).
 * Mounts inside the work area and positions absolutely over the canvas.
 * pointer-events: none ensures tldraw stays fully interactive underneath.
 *
 * Styling lives in App.css under `.theme-deco-*` selectors, scoped by
 * `html[data-theme="..."]`.
 */
export function ThemeDecorations({ theme, boardName }) {
  if (!theme || theme === 'aurora' || theme === 'glass') return null

  if (theme === 'hud') {
    return (
      <div className="theme-deco theme-deco-hud" aria-hidden="true">
        <span className="theme-deco-corner tl" />
        <span className="theme-deco-corner tr" />
        <span className="theme-deco-corner bl" />
        <span className="theme-deco-corner br" />
        <div className="theme-deco-scanline" />
        <div className="theme-deco-hud-readout">
          <div>:: SYS <b>//</b> operational</div>
          <div>:: NET <b>//</b> autosave <em>OK</em></div>
          {boardName && <div>:: DOC <b>//</b> {boardName}</div>}
        </div>
      </div>
    )
  }

  if (theme === 'abyss') {
    return (
      <div className="theme-deco theme-deco-abyss" aria-hidden="true">
        <svg
          className="theme-deco-caustic"
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
        >
          <defs>
            <radialGradient id="s8-abyss-caustic" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#3AF5B8" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3AF5B8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="300"  cy="700" rx="360" ry="170" fill="url(#s8-abyss-caustic)" />
          <ellipse cx="1100" cy="200" rx="300" ry="180" fill="url(#s8-abyss-caustic)" opacity="0.6" />
          <ellipse cx="750"  cy="450" rx="200" ry="120" fill="url(#s8-abyss-caustic)" opacity="0.5" />
        </svg>
      </div>
    )
  }

  if (theme === 'archive') {
    return (
      <div className="theme-deco theme-deco-archive" aria-hidden="true">
        <div className="theme-deco-rule top" />
        <div className="theme-deco-rule bot" />
        <div className="theme-deco-stamp">
          <div>STATION 8</div>
          <div>—</div>
          {boardName && <div>{boardName}</div>}
          <div>ARCHIVE · {new Date().getFullYear()}</div>
        </div>
        <div className="theme-deco-foot">
          STATION 8 / RESEARCH · ARCHIVE BUILD
        </div>
      </div>
    )
  }

  if (theme === 'prism') {
    return (
      <div className="theme-deco theme-deco-prism" aria-hidden="true">
        <div className="theme-deco-prism-glow tl" />
        <div className="theme-deco-prism-glow br" />
      </div>
    )
  }

  return null
}
