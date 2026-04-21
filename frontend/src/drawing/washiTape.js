// Washi tape helper — decorative FigJam-style tape strips built out of plain
// Excalidraw rectangles and ellipses. Excalidraw has no native pattern brush,
// so every "style" is just a primary tinted rectangle plus a handful of
// secondary sub-shapes laid out along the tape's length.

export const WASHI_STYLES = {
  stripes:     { name: 'Stripes',    colors: ['#FFB3B3', '#fff'] },
  polka:       { name: 'Polka dots', colors: ['#FFD36A', '#fff'] },
  solidPink:   { name: 'Pink',       colors: ['#FFB3D9'] },
  solidMint:   { name: 'Mint',       colors: ['#B3E8C9'] },
  solidBlue:   { name: 'Blue',       colors: ['#B3D9FF'] },
  solidPurple: { name: 'Purple',     colors: ['#C9B3FF'] },
}

function rid() {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)
}

function rseed() {
  return Math.floor(Math.random() * 1e6)
}

// Build one Excalidraw element with every one of the 24 standard fields set
// so the scene can accept it without schema warnings.
function baseElement(overrides = {}) {
  const now = Date.now()
  return {
    id: rid(),
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 0,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: rseed(),
    version: 1,
    versionNonce: rseed(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    ...overrides,
  }
}

export function makeWashiStrip({ x1, y1, x2, y2, style = 'stripes', width = 28 }) {
  const styleDef = WASHI_STYLES[style] || WASHI_STYLES.stripes
  const primary = styleDef.colors[0]
  const secondary = styleDef.colors[1] || styleDef.colors[0]

  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy))
  const angle = Math.atan2(dy, dx)

  const groupId = rid()
  const elements = []

  // Base tape rectangle — tinted primary colour at 80% opacity so overlapping
  // content underneath is still faintly visible (like real washi tape).
  elements.push(
    baseElement({
      type: 'rectangle',
      x: x1,
      y: y1 - width / 2,
      width: length,
      height: width,
      angle,
      strokeColor: 'transparent',
      backgroundColor: primary,
      fillStyle: 'solid',
      strokeWidth: 0,
      opacity: 80,
      groupIds: [groupId],
      customData: { washi: true, washiStyle: style, washiRole: 'base' },
    })
  )

  if (style === 'stripes') {
    // Cross-hatch: 6 evenly spaced secondary-colour bars running across the tape.
    const bars = 6
    const barW = Math.max(4, length / (bars * 2))
    const gap = (length - bars * barW) / (bars + 1)
    for (let i = 0; i < bars; i++) {
      const offset = gap + i * (barW + gap)
      // Local coords (along-tape, across-tape). Rotate around (x1, y1).
      const localX = offset
      const localY = -width / 2 + 4
      const rx = x1 + localX * Math.cos(angle) - localY * Math.sin(angle)
      const ry = y1 + localX * Math.sin(angle) + localY * Math.cos(angle)
      elements.push(
        baseElement({
          type: 'rectangle',
          x: rx,
          y: ry,
          width: barW,
          height: width - 8,
          angle,
          strokeColor: 'transparent',
          backgroundColor: secondary,
          fillStyle: 'solid',
          strokeWidth: 0,
          opacity: 70,
          groupIds: [groupId],
          customData: { washi: true, washiStyle: style, washiRole: 'stripe' },
        })
      )
    }
  } else if (style === 'polka') {
    // Row of small ellipses centred along the tape.
    const dots = 7
    const dotSize = Math.min(width - 10, 12)
    const step = length / (dots + 1)
    for (let i = 1; i <= dots; i++) {
      const localX = i * step - dotSize / 2
      const localY = -dotSize / 2
      const rx = x1 + localX * Math.cos(angle) - localY * Math.sin(angle)
      const ry = y1 + localX * Math.sin(angle) + localY * Math.cos(angle)
      elements.push(
        baseElement({
          type: 'ellipse',
          x: rx,
          y: ry,
          width: dotSize,
          height: dotSize,
          angle,
          strokeColor: 'transparent',
          backgroundColor: secondary,
          fillStyle: 'solid',
          strokeWidth: 0,
          opacity: 85,
          groupIds: [groupId],
          customData: { washi: true, washiStyle: style, washiRole: 'dot' },
        })
      )
    }
  }
  // Solid styles: the single base rectangle is the whole tape.

  return elements
}
