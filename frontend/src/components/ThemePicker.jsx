import { useEffect, useRef, useState } from 'react'

/** Order matters — renders this way in the popover. Glass first (default). */
export const BOARD_THEMES = [
  {
    id: 'glass',
    name: 'Liquid Glass',
    description: 'visionOS depth',
    swatch: '#7CE6FF',
    tag: 'DEFAULT',
  },
  {
    id: 'hud',
    name: 'Command Deck',
    description: 'tactical hud',
    swatch: '#FFA528',
  },
  {
    id: 'abyss',
    name: 'Abyss',
    description: 'bioluminescent',
    swatch: '#3AF5B8',
  },
  {
    id: 'archive',
    name: 'Archive',
    description: 'brutalist catalogue',
    swatch: '#E04747',
  },
  {
    id: 'prism',
    name: 'Prisma',
    description: 'holographic',
    swatch: 'linear-gradient(135deg, #60F0FF, #FF5CE0)',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'purple + teal · legacy',
    swatch: '#9d7df2',
  },
]

export const VISITOR_RANDOM_POOL = ['glass', 'hud', 'abyss', 'archive', 'prism']

export function ThemePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const current = BOARD_THEMES.find(t => t.id === value) || BOARD_THEMES[0]

  return (
    <div className="theme-picker-root" ref={rootRef}>
      <button
        type="button"
        className="theme-picker-trigger"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        aria-label={`Board theme: ${current.name}`}
        title={`Board theme · ${current.name}`}
      >
        <span
          className="theme-picker-trigger-dot"
          style={{ background: current.swatch }}
        />
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          className="theme-picker-trigger-caret"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="theme-picker-popover">
          <div className="theme-picker-popover-head">
            <span>Board theme</span>
          </div>
          <div className="theme-picker-popover-body">
            {BOARD_THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                className={`theme-picker-row${t.id === value ? ' is-active' : ''}`}
                onClick={() => { onChange(t.id); setOpen(false) }}
              >
                <span
                  className="theme-picker-row-dot"
                  style={{ background: t.swatch }}
                />
                <span className="theme-picker-row-text">
                  <span className="theme-picker-row-name">
                    {t.name}
                    {t.tag && <span className="theme-picker-row-tag">{t.tag}</span>}
                  </span>
                  <span className="theme-picker-row-desc">{t.description}</span>
                </span>
                <span className="theme-picker-row-check" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
          <div className="theme-picker-popover-foot">
            Applies to this board · saved on selection
          </div>
        </div>
      )}
    </div>
  )
}
