// Minimal stroke-based SVG icons. 1.75px stroke, 20px box. Keep inline — zero dependency.
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
    <svg {...common} {...props}>
      <rect x="3" y="3" width="14" height="14" rx="2"/>
      <path d="M3 8h14M8 3v14"/>
    </svg>
  )
}

export function SheetIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="3" y="3" width="14" height="14" rx="1"/>
      <path d="M3 8h14M3 13h14M8 3v14M13 3v14"/>
    </svg>
  )
}

export function FolderIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H8l1.5 1.8h6A1.5 1.5 0 0 1 17 8.3v6.2A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5z"/>
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

export function SidebarCollapseIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="3" y="3" width="14" height="14" rx="2"/>
      <path d="M7 3v14"/>
      <path d="M11.5 10 9 8v4z" fill="currentColor" stroke="none"/>
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

/* ─── FigJam-style canvas-toolbar icons (colored, 22px) ─── */

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

const STICKY_ICON_PALETTE = {
  yellow: { bg: '#FFE066', fold: '#FFD43B', stroke: '#C9A227' },
  pink:   { bg: '#FFB3C7', fold: '#F89BB4', stroke: '#C0486A' },
  blue:   { bg: '#B3D9FF', fold: '#9AC9F5', stroke: '#2E7AB8' },
  green:  { bg: '#C5E8A5', fold: '#B0DD8A', stroke: '#5A8E30' },
  orange: { bg: '#FFCB8A', fold: '#F2B770', stroke: '#C8751A' },
  purple: { bg: '#D9C6FF', fold: '#C5ADFA', stroke: '#6A3FBF' },
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
            fill="#ffffff" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M13.5 4.5l6 6-3 3-6-6z"
            fill="#FF7AA2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
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

export function FjCleanStyleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="12" rx="2"/>
    </svg>
  )
}

export function FjSketchStyleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 7.1c2-1 4.2-1.4 7.8-1.3 3.4.1 6 .5 7.9 1.2"/>
      <path d="M19.6 7.3c.5 1.7.6 4.1.1 6 -.4 1.7-.3 3.5-.2 4.2"/>
      <path d="M19.5 17.7c-2 1-4.6 1.3-8 1.2-3.5-.1-5.8-.6-7.6-1.3"/>
      <path d="M4.1 17.2c-.5-1.7-.6-4.2-.1-6 .4-1.6.3-3.5.2-4.1"/>
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

export function FjFontIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l3-10h4l3 10"/>
      <path d="M5.5 16h6"/>
      <path d="M14 10h4"/>
      <path d="M16 10v10"/>
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

export function EmptyBoardIcon(props) {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="4" width="20" height="20" rx="2"/>
      <path d="M9 10h10M9 14h10M9 18h6"/>
    </svg>
  )
}
