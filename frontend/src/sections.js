import { convertToExcalidrawElements } from '@excalidraw/excalidraw'

export const SECTION_COLORS = {
  grey:   { bg: '#f1f3f5', stroke: '#868e96', label: 'Grey' },
  blue:   { bg: '#e7f5ff', stroke: '#1c7ed6', label: 'Blue' },
  green:  { bg: '#ebfbee', stroke: '#2b8a3e', label: 'Green' },
  yellow: { bg: '#fff9db', stroke: '#f08c00', label: 'Yellow' },
  orange: { bg: '#fff4e6', stroke: '#e8590c', label: 'Orange' },
  red:    { bg: '#fff5f5', stroke: '#c92a2a', label: 'Red' },
  pink:   { bg: '#fff0f6', stroke: '#d6336c', label: 'Pink' },
  purple: { bg: '#f8f0fc', stroke: '#862e9c', label: 'Purple' },
}

export const STICKY_COLORS = {
  yellow: { bg: '#FFE066', stroke: '#C9A227' },
  pink:   { bg: '#FFB3C7', stroke: '#C0486A' },
  blue:   { bg: '#B3D9FF', stroke: '#2E7AB8' },
  green:  { bg: '#C5E8A5', stroke: '#5A8E30' },
  orange: { bg: '#FFCB8A', stroke: '#C8751A' },
  purple: { bg: '#D9C6FF', stroke: '#6A3FBF' },
}

export const SECTION_DEFAULT_NAME = 'Section'
export const SECTION_DEFAULT_W = 520
export const SECTION_DEFAULT_H = 360
export const SECTION_MIN_SIZE = 80

export function isSectionElement(element) {
  return element?.type === 'frame' || Boolean(element?.customData?.isSection)
}

export function makeSection({ x, y, w = SECTION_DEFAULT_W, h = SECTION_DEFAULT_H, color = 'blue', name, id } = {}) {
  const c = SECTION_COLORS[color] || SECTION_COLORS.blue
  const sectionName = name ?? SECTION_DEFAULT_NAME

  // Sections are a single styled rectangle. Title is rendered as an HTML
  // overlay (see App.jsx) so it stays screen-space constant size like FigJam,
  // is always above the rectangle, and never scales with zoom.
  return convertToExcalidrawElements([
    {
      id,
      type: 'rectangle',
      x,
      y,
      width: w,
      height: h,
      strokeColor: c.stroke,
      backgroundColor: c.bg,
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 0,
      roundness: null,
      customData: {
        isSection: true,
        sectionColor: color,
        sectionLock: 'none',
        sectionName,
      },
    },
  ])
}

export function nextSectionName(elements) {
  let maxNum = 0
  for (const element of elements) {
    if (!isSectionElement(element)) continue
    const nameSource = element.customData?.sectionName || element.name || ''
    const match = /^Section\s+(\d+)$/.exec(nameSource)
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10))
  }
  return `Section ${maxNum + 1}`
}

export function isSectionLabel(element) {
  return Boolean(element?.customData?.isSectionLabel)
}

export function viewportCenter(excalidrawAPI) {
  if (!excalidrawAPI) return { x: 0, y: 0 }
  const state = excalidrawAPI.getAppState()
  const zoom = state.zoom?.value || 1
  const cx = -state.scrollX + state.width / (2 * zoom)
  const cy = -state.scrollY + state.height / (2 * zoom)
  return { x: cx, y: cy }
}

export function makeSticky({ x, y, size = 180, color = 'yellow' }) {
  const c = STICKY_COLORS[color] || STICKY_COLORS.yellow

  return convertToExcalidrawElements([
    {
      type: 'rectangle',
      x,
      y,
      width: size,
      height: size,
      strokeColor: 'transparent',
      backgroundColor: c.bg,
      fillStyle: 'solid',
      strokeWidth: 0,
      strokeStyle: 'solid',
      roughness: 0,
      // FigJam-style: sharp, crisp corners — no roundness.
      roundness: null,
      customData: { stickyColor: color, isSticky: true },
    },
  ])
}
