import { convertToExcalidrawElements, ROUNDNESS } from '@excalidraw/excalidraw'

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

export const SECTION_DEFAULT_NAME = 'Untitled section'

export function isSectionElement(element) {
  return element?.type === 'frame' || Boolean(element?.customData?.isSection)
}

export function isSectionLabel(element) {
  return Boolean(element?.customData?.isSectionLabel)
}

export function makeSection({ x, y, w = 560, h = 380, color = 'blue', name = SECTION_DEFAULT_NAME, id } = {}) {
  const c = SECTION_COLORS[color] || SECTION_COLORS.blue

  return convertToExcalidrawElements([
    {
      id,
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
      customData: { isSection: true, sectionColor: color, sectionLock: 'none' },
    },
  ])
}

function normalizeFrameSection(element, labelText) {
  const color = element.customData?.sectionColor || 'blue'
  const c = SECTION_COLORS[color] || SECTION_COLORS.blue
  return {
    ...element,
    strokeColor: c.stroke,
    backgroundColor: c.bg,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    name: labelText ?? element.name ?? SECTION_DEFAULT_NAME,
    customData: {
      ...element.customData,
      isSection: true,
      sectionColor: color,
      sectionLock: element.customData?.sectionLock || 'none',
    },
  }
}

function isWithinFrameBounds(element, frame) {
  if (!element || !frame) return false
  const padding = 12
  const left = frame.x
  const top = frame.y
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height
  return (
    element.x >= left + padding &&
    element.y >= top + padding &&
    element.x + element.width <= right - padding &&
    element.y + element.height <= bottom - padding
  )
}

export function migrateLegacySections(elements) {
  const migrated = []
  const oldSectionRects = elements.filter(el => el.type === 'rectangle' && el.customData?.isSection)
  const sectionLabels = elements.filter(isSectionLabel)
  const labelBySectionId = new Map(sectionLabels.map(label => [label.customData.sectionId, label.text]))
  const oldSectionIds = new Set(oldSectionRects.map(r => r.id))
  const normalizedFrames = []

  if (oldSectionIds.size === 0 && !elements.some(el => el.type === 'frame') && sectionLabels.length === 0) return elements

  for (const element of elements) {
    if (element.type === 'rectangle' && element.customData?.isSection) {
      const color = element.customData.sectionColor || 'blue'
      const [frame] = makeSection({
        id: element.id,
        x: element.x,
        y: element.y,
        w: element.width,
        h: element.height,
        color,
        name: labelBySectionId.get(element.id) || element.name || SECTION_DEFAULT_NAME,
      })
      normalizedFrames.push(frame)
      migrated.push(frame)
      continue
    }

    if (isSectionLabel(element)) {
      continue
    }

    if (element.type === 'frame') {
      const normalized = normalizeFrameSection(element, labelBySectionId.get(element.id))
      normalizedFrames.push(normalized)
      migrated.push(normalized)
      continue
    }

    migrated.push(element)
  }

  return migrated.map((element) => {
    if (isSectionElement(element) || isSectionLabel(element)) return element
    if (element.frameId) return element

    const containingFrame = normalizedFrames.find(frame => isWithinFrameBounds(element, frame))
    if (!containingFrame) return element
    return { ...element, frameId: containingFrame.id }
  })
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
