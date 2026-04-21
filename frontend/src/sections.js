import { convertToExcalidrawElements, FONT_FAMILY, ROUNDNESS } from '@excalidraw/excalidraw'

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

const SECTION_FONT_SIZE = 24
const SECTION_TEXT_PADDING_X = 18
const SECTION_TEXT_PADDING_Y = 16

function rid() {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)
}

export function isSectionElement(element) {
  return element?.type === 'frame' || Boolean(element?.customData?.isSection)
}

export function isSectionLabel(element) {
  return Boolean(element?.customData?.isSectionLabel)
}

export function makeSection({ x, y, w = 560, h = 380, color = 'blue', name = 'Section', id } = {}) {
  const rectId = id || rid()
  const textId = rid()
  const c = SECTION_COLORS[color] || SECTION_COLORS.blue

  return convertToExcalidrawElements([
    {
      id: rectId,
      type: 'frame',
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
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      name: name,
      customData: { isSection: true, sectionColor: color, labelId: textId },
    },
    {
      id: textId,
      type: 'text',
      x: x + SECTION_TEXT_PADDING_X,
      y: y + SECTION_TEXT_PADDING_Y,
      width: Math.max(180, w - SECTION_TEXT_PADDING_X * 2),
      height: SECTION_FONT_SIZE + 10,
      text: name,
      originalText: name,
      fontFamily: FONT_FAMILY.Helvetica,
      fontSize: SECTION_FONT_SIZE,
      textAlign: 'left',
      verticalAlign: 'top',
      autoResize: false,
      lineHeight: 1.25,
      containerId: rectId,
      strokeColor: c.stroke,
      backgroundColor: 'transparent',
      roughness: 0,
      customData: { isSectionLabel: true, sectionId: rectId },
    },
  ])
}

export function migrateLegacySections(elements) {
  // Convert old rectangle sections to frames
  const migrated = []
  const oldSectionRects = elements.filter(el => el.type === 'rectangle' && el.customData?.isSection)
  const oldSectionIds = new Set(oldSectionRects.map(r => r.id))
  
  if (oldSectionIds.size === 0 && !elements.some(el => el.type === 'frame')) return elements

  for (const element of elements) {
    if (element.type === 'rectangle' && element.customData?.isSection) {
      const color = element.customData.sectionColor || 'blue'
      const label = elements.find(el => el.customData?.sectionId === element.id)
      const nextSection = makeSection({
        id: element.id,
        x: element.x,
        y: element.y,
        w: element.width,
        h: element.height,
        color,
        name: label?.text || 'Section',
      })
      migrated.push(...nextSection)
      continue
    }
    
    // Skip old labels as makeSection creates new ones
    if (element.customData?.isSectionLabel && oldSectionIds.has(element.customData.sectionId)) {
      continue
    }

    migrated.push(element)
  }

  return migrated
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
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      customData: { stickyColor: color, isSticky: true },
    },
  ])
}
