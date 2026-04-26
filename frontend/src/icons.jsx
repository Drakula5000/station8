// Minimal stroke-based SVG icons. 0.1094rem stroke, 1.25rem box. Keep inline — zero dependency.
const common = {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function BoardIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1"/>
      <rect x="3.5" y="3.5" width="2.8" height="2.8" rx=".5" fill="currentColor" opacity=".45"/>
      <rect x="7.7" y="3.5" width="2.8" height="2.8" rx=".5" fill="currentColor" opacity=".45"/>
      <rect x="3.5" y="7.7" width="2.8" height="2.8" rx=".5" fill="currentColor" opacity=".45"/>
    </svg>
  )
}

export function SheetIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1"/>
      <line x1="1.5" y1="4.8" x2="12.5" y2="4.8" stroke="currentColor" strokeWidth=".9"/>
      <line x1="1.5" y1="9.2" x2="12.5" y2="9.2" stroke="currentColor" strokeWidth=".9"/>
      <line x1="5" y1="1.5" x2="5" y2="12.5" stroke="currentColor" strokeWidth=".9"/>
    </svg>
  )
}

export function ReportIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1"/>
      <polyline points="3.5,9.5 6,7 8,8.5 10.5,4.5" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="3.5" cy="9.5" r="0.7" fill="currentColor"/>
      <circle cx="6" cy="7" r="0.7" fill="currentColor"/>
      <circle cx="8" cy="8.5" r="0.7" fill="currentColor"/>
      <circle cx="10.5" cy="4.5" r="0.7" fill="currentColor"/>
    </svg>
  )
}

export function DocIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <path d="M3.2 1.5h4.6l3 3V12a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      <path d="M7.8 1.5v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      <line x1="4.2" y1="7.4" x2="9.8" y2="7.4" stroke="currentColor" strokeWidth=".9" strokeLinecap="round"/>
      <line x1="4.2" y1="9.2" x2="9.8" y2="9.2" stroke="currentColor" strokeWidth=".9" strokeLinecap="round"/>
      <line x1="4.2" y1="11" x2="7.8" y2="11" stroke="currentColor" strokeWidth=".9" strokeLinecap="round"/>
    </svg>
  )
}

// Monochrome Google G — uses currentColor so it inherits the parent's color
// and stays on-theme. The path is the canonical Google G outline merged into
// a single shape, then notched on the right where the brand mark has its
// horizontal bar (the bar that gives the G its negative space).
export function GoogleLogoIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor" {...props}>
      <path d="M9 0a9 9 0 1 0 8.79 10.91H9V7.06h8.57Q18 8.06 18 9A9 9 0 0 0 9 0Zm0 14.4A5.4 5.4 0 1 1 12.6 5.04L15.16 2.5A8.97 8.97 0 0 0 9 0a9 9 0 0 0 0 18 8.93 8.93 0 0 0 5.94-2.18L12.05 13.55A5.36 5.36 0 0 1 9 14.4Z"/>
    </svg>
  )
}

export function FolderIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <path d="M1.5 4C1.5 3.45 1.95 3 2.5 3H5.5L7 4.5H11.5C12.05 4.5 12.5 4.95 12.5 5.5V10.5C12.5 11.05 12.05 11.5 11.5 11.5H2.5C1.95 11.5 1.5 11.05 1.5 10.5V4Z" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  )
}

export function PlusIcon(props) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...props}>
      <path d="M6 1V11M1 6H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

export function GlobeIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M1.6 7h10.8" stroke="currentColor" strokeWidth="1.1"/>
      <path d="M7 1.6c1.5 1.5 2.4 3.4 2.4 5.4S8.5 10.9 7 12.4M7 1.6C5.5 3.1 4.6 5 4.6 7s.9 3.9 2.4 5.4" stroke="currentColor" strokeWidth="1.1" fill="none"/>
    </svg>
  )
}

export function PinIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...props}>
      <path d="M7 1.4c-2.21 0-4 1.74-4 3.88 0 2.91 4 7.32 4 7.32s4-4.41 4-7.32c0-2.14-1.79-3.88-4-3.88Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
      <circle cx="7" cy="5.3" r="1.35" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  )
}

export function FolderOpenIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M3 7.2A1.5 1.5 0 0 1 4.5 5.7H8l1.4 1.6h6.1A1.5 1.5 0 0 1 17 8.8v.4"/>
      <path d="M4.1 9.4h12.8a1 1 0 0 1 .95 1.32l-1.1 3.6A1.5 1.5 0 0 1 15.3 15H4.9a1.5 1.5 0 0 1-1.43-1.96l.68-2.27A2 2 0 0 1 4.1 9.4Z"/>
    </svg>
  )
}

export function ChevronRightIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M7.5 5.5 12.5 10l-5 4.5"/>
    </svg>
  )
}

export function FjChevronDownIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" {...props}>
      <path
        d="M5.5 7.5 10 12l4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SearchIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="9" cy="9" r="5"/>
      <path d="M13 13l4 4"/>
    </svg>
  )
}

export function CloseIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M5 5l10 10M15 5L5 15"/>
    </svg>
  )
}

export function ThemeToggleIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="10" cy="10" r="6"/>
      <path d="M10 4v12" />
      <path d="M10 4a6 6 0 0 0 0 12z" fill="currentColor" stroke="none"/>
    </svg>
  )
}

export function LogoutIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M11.5 4.5h-5a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h5"/>
      <path d="M9 10h7"/>
      <path d="M13.5 7l3 3-3 3"/>
    </svg>
  )
}

export function SidebarExpandIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="3" y="3" width="14" height="14" rx="2"/>
      <path d="M7 3v14"/>
      <path d="M9.5 10 12 12V8z" fill="currentColor" stroke="none"/>
    </svg>
  )
}

export function TrashIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M3 6h14"/>
      <path d="M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>
      <path d="M5 6v10a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6"/>
      <path d="M8 10v4M12 10v4"/>
    </svg>
  )
}

export function LockIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="4" y="9" width="12" height="9" rx="2"/>
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>
    </svg>
  )
}

export function UnlockIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="4" y="9" width="12" height="9" rx="2"/>
      <path d="M7 9V6.5a3 3 0 0 1 5.5-1.8"/>
    </svg>
  )
}

/* ─── FigJam-style canvas-toolbar icons (colored, 1.375rem) ─── */

export function FjCursorIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M6 4l11 8.5-4.8 1-1.9 5.8z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

export function FjHandIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 11V5.5a1.2 1.2 0 1 1 2.4 0V10"/>
      <path d="M10.4 10V4.2a1.2 1.2 0 1 1 2.4 0V10"/>
      <path d="M12.8 10.2V5.5a1.2 1.2 0 1 1 2.4 0v4.7"/>
      <path d="M15.2 9a1.2 1.2 0 1 1 2.4 0v6.5a5 5 0 0 1-5 5h-2a4 4 0 0 1-3.5-2l-2.5-4.3a1.2 1.2 0 0 1 2-1.3L8.5 15"/>
    </svg>
  )
}

// Sticky-icon palette references CSS tokens defined in App.css :root
// (the `yellow` legacy key maps to the lavender swatch).
const STICKY_ICON_PALETTE = {
  yellow: { bg: 'var(--s8-tl-lavender)', fold: 'var(--s8-tl-lavender-fold)', stroke: 'var(--s8-tl-lavender-stroke)' },
  pink:   { bg: 'var(--s8-tl-pink)',     fold: 'var(--s8-tl-pink-fold)',     stroke: 'var(--s8-tl-pink-stroke)' },
  blue:   { bg: 'var(--s8-tl-blue)',     fold: 'var(--s8-tl-blue-fold)',     stroke: 'var(--s8-tl-blue-stroke)' },
  green:  { bg: 'var(--s8-tl-teal)',     fold: 'var(--s8-tl-teal-fold)',     stroke: 'var(--s8-tl-teal-stroke)' },
  orange: { bg: 'var(--s8-tl-orange)',   fold: 'var(--s8-tl-orange-fold)',   stroke: 'var(--s8-tl-orange-stroke)' },
  purple: { bg: 'var(--s8-tl-violet)',   fold: 'var(--s8-tl-violet-fold)',   stroke: 'var(--s8-tl-violet-stroke)' },
}

export function FjStickyIcon({ color = 'yellow' } = {}) {
  const c = STICKY_ICON_PALETTE[color] || STICKY_ICON_PALETTE.yellow
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9.8L14.3 21H5.5A1.5 1.5 0 0 1 4 19.5z"
            fill={c.bg} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M14.3 21v-4.2a1.5 1.5 0 0 1 1.5-1.5H20"
            fill={c.fold} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

export function FjTextIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7V5h14v2"/>
      <path d="M12 5v14"/>
      <path d="M9 19h6"/>
    </svg>
  )
}

export function FjArrowIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15"/>
      <path d="M14 7l5 5-5 5"/>
    </svg>
  )
}

export function FjPenIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M13.5 4.5l6 6-10.5 10.5-5 1 1-5z"
            fill="var(--s8-tl-white)" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M13.5 4.5l6 6-3 3-6-6z"
            fill="var(--s8-fj-pen-accent)" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M6 17l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

export function FjRectIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="12" rx="2"/>
    </svg>
  )
}

export function FjEllipseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <ellipse cx="12" cy="12" rx="8" ry="6"/>
    </svg>
  )
}

export function FjDiamondIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 4l8 8-8 8-8-8z"/>
    </svg>
  )
}

export function FjLineIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 12h16"/>
    </svg>
  )
}

export function FjSectionIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M4 9.2h16" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.5 2.5"/>
    </svg>
  )
}

export function FjDraftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19c2-1 3-4 5-4s2 3 4 3 3-5 5-5 2 3 3 3"/>
    </svg>
  )
}

export function FjDataIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7l-4 5 4 5"/>
      <path d="M16 7l4 5-4 5"/>
      <path d="M14 5l-4 14"/>
    </svg>
  )
}

export function FjAnalysisIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 20l4.5-13h1L15 20"/>
      <path d="M6.8 15.6h6.4"/>
    </svg>
  )
}

export function FjInsightIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6h14"/>
      <path d="M5 6l1.5 1M19 6l-1.5 1"/>
      <path d="M12 6v13"/>
      <path d="M9.5 19h5"/>
    </svg>
  )
}

