// FigJam-style feedback stamps as native Excalidraw library items.
// Each stamp is a small (~60x60) composition of native elements: ellipse,
// rectangle, diamond, line, and text (glyph characters only — no emojis).
//
// Template elements are authored at origin (0,0) — i.e. the stamp's logical
// bounding box is centered roughly at (30, 30). makeStampElements() clones
// the template, assigns fresh ids/seeds/nonces, and translates the group so
// its center lands at the requested (x, y) in canvas coordinates.

function rid() {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)
}

function rseed() {
  return Math.floor(Math.random() * 1e6)
}

// ----- element factories -----

function baseDefaults() {
  return {
    angle: 0,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    isDeleted: false,
    version: 1,
  }
}

function ellipse({ x, y, w, h, stroke, bg, strokeWidth = 2, groupId }) {
  return {
    ...baseDefaults(),
    id: rid(),
    type: 'ellipse',
    x, y, width: w, height: h,
    strokeColor: stroke,
    backgroundColor: bg,
    fillStyle: 'solid',
    strokeWidth,
    groupIds: [groupId],
    roundness: { type: 2 },
    seed: rseed(),
    versionNonce: rseed(),
  }
}

function rectangle({ x, y, w, h, stroke, bg, strokeWidth = 2, rounded = false, groupId }) {
  return {
    ...baseDefaults(),
    id: rid(),
    type: 'rectangle',
    x, y, width: w, height: h,
    strokeColor: stroke,
    backgroundColor: bg,
    fillStyle: 'solid',
    strokeWidth,
    groupIds: [groupId],
    roundness: rounded ? { type: 3 } : null,
    seed: rseed(),
    versionNonce: rseed(),
  }
}

function diamond({ x, y, w, h, stroke, bg, strokeWidth = 2, groupId }) {
  return {
    ...baseDefaults(),
    id: rid(),
    type: 'diamond',
    x, y, width: w, height: h,
    strokeColor: stroke,
    backgroundColor: bg,
    fillStyle: 'solid',
    strokeWidth,
    groupIds: [groupId],
    roundness: { type: 2 },
    seed: rseed(),
    versionNonce: rseed(),
  }
}

function line({ x, y, points, stroke, strokeWidth = 3, groupId }) {
  // `points` is relative to (x, y). width/height derived from points bounds.
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  return {
    ...baseDefaults(),
    id: rid(),
    type: 'line',
    x, y, width: w, height: h,
    strokeColor: stroke,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth,
    groupIds: [groupId],
    roundness: null,
    seed: rseed(),
    versionNonce: rseed(),
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
  }
}

function text({ x, y, w, h, value, color = '#1a1a1a', fontSize = 28, groupId }) {
  return {
    ...baseDefaults(),
    id: rid(),
    type: 'text',
    x, y, width: w, height: h,
    strokeColor: color,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    groupIds: [groupId],
    roundness: null,
    seed: rseed(),
    versionNonce: rseed(),
    text: value,
    fontSize,
    fontFamily: 1,
    textAlign: 'center',
    verticalAlign: 'middle',
    baseline: Math.round(fontSize * 0.8),
    containerId: null,
    originalText: value,
    lineHeight: 1.25,
    autoResize: true,
  }
}

// ----- stamp templates -----
// Every template is authored so the visual sits roughly inside the 60x60 box
// with center at (30, 30). SIZE below is informational only.

const SIZE = 60

function tplApproved() {
  const g = 'stamp-approved'
  // Green filled circle + white check via a polyline.
  return [
    ellipse({ x: 0, y: 0, w: 60, h: 60, stroke: '#1f7a3a', bg: '#2fb35a', groupId: g }),
    // check: three-point polyline, drawn with thick white stroke
    line({
      x: 18, y: 30,
      points: [[0, 2], [8, 10], [22, -6]],
      stroke: '#ffffff',
      strokeWidth: 4,
      groupId: g,
    }),
  ]
}

function tplRejected() {
  const g = 'stamp-rejected'
  return [
    ellipse({ x: 0, y: 0, w: 60, h: 60, stroke: '#a82d2d', bg: '#e04545', groupId: g }),
    line({
      x: 20, y: 20,
      points: [[0, 0], [20, 20]],
      stroke: '#ffffff',
      strokeWidth: 4,
      groupId: g,
    }),
    line({
      x: 20, y: 40,
      points: [[0, 0], [20, -20]],
      stroke: '#ffffff',
      strokeWidth: 4,
      groupId: g,
    }),
  ]
}

function tplQuestion() {
  const g = 'stamp-question'
  return [
    ellipse({ x: 0, y: 0, w: 60, h: 60, stroke: '#1e5fb5', bg: '#3a86e0', groupId: g }),
    text({ x: 18, y: 12, w: 24, h: 36, value: '?', color: '#ffffff', fontSize: 32, groupId: g }),
  ]
}

function tplPriority() {
  const g = 'stamp-priority'
  return [
    diamond({ x: 0, y: 0, w: 60, h: 60, stroke: '#c2611a', bg: '#f08b2c', groupId: g }),
    text({ x: 24, y: 14, w: 12, h: 32, value: '!', color: '#ffffff', fontSize: 30, groupId: g }),
  ]
}

function tplStar() {
  const g = 'stamp-star'
  // Yellow backing circle + black star glyph. Glyph, not emoji.
  return [
    ellipse({ x: 0, y: 0, w: 60, h: 60, stroke: '#b78a1a', bg: '#ffd83d', groupId: g }),
    text({ x: 12, y: 12, w: 36, h: 36, value: '★', color: '#7a5a00', fontSize: 36, groupId: g }),
  ]
}

function tplHeart() {
  const g = 'stamp-heart'
  return [
    ellipse({ x: 0, y: 0, w: 60, h: 60, stroke: '#c8458f', bg: '#ffd6ef', groupId: g }),
    text({ x: 12, y: 12, w: 36, h: 36, value: '♥', color: '#d13a6e', fontSize: 36, groupId: g }),
  ]
}

function tplPlusOne() {
  const g = 'stamp-plus-one'
  // Grey pill (rounded rectangle) + "+1" text
  return [
    rectangle({ x: 0, y: 15, w: 60, h: 30, stroke: '#777', bg: '#ededed', rounded: true, groupId: g }),
    text({ x: 12, y: 20, w: 36, h: 22, value: '+1', color: '#333', fontSize: 20, groupId: g }),
  ]
}

function tplMinusOne() {
  const g = 'stamp-minus-one'
  return [
    rectangle({ x: 0, y: 15, w: 60, h: 30, stroke: '#777', bg: '#ededed', rounded: true, groupId: g }),
    text({ x: 14, y: 20, w: 32, h: 22, value: '-1', color: '#333', fontSize: 20, groupId: g }),
  ]
}

function tplNumber(n, { bg, stroke, fg }) {
  const g = `stamp-number-${n}`
  return [
    ellipse({ x: 0, y: 0, w: 60, h: 60, stroke, bg, groupId: g }),
    text({ x: 18, y: 14, w: 24, h: 32, value: String(n), color: fg, fontSize: 28, groupId: g }),
  ]
}

// ----- stamp registry -----

export const STAMPS = [
  {
    id: 'stamp-approved',
    name: 'Approved',
    keywords: ['approved', 'check', 'yes', 'ok', 'accept'],
    elements: tplApproved(),
  },
  {
    id: 'stamp-rejected',
    name: 'Rejected',
    keywords: ['rejected', 'no', 'cross', 'x', 'deny'],
    elements: tplRejected(),
  },
  {
    id: 'stamp-question',
    name: 'Question',
    keywords: ['question', 'unclear', 'ask', '?'],
    elements: tplQuestion(),
  },
  {
    id: 'stamp-priority',
    name: 'Priority',
    keywords: ['priority', 'important', 'urgent', '!'],
    elements: tplPriority(),
  },
  {
    id: 'stamp-star',
    name: 'Star',
    keywords: ['star', 'favorite', 'highlight'],
    elements: tplStar(),
  },
  {
    id: 'stamp-heart',
    name: 'Heart',
    keywords: ['heart', 'love', 'like'],
    elements: tplHeart(),
  },
  {
    id: 'stamp-plus-one',
    name: '+1',
    keywords: ['plus', 'upvote', 'agree', '+1'],
    elements: tplPlusOne(),
  },
  {
    id: 'stamp-minus-one',
    name: '-1',
    keywords: ['minus', 'downvote', 'disagree', '-1'],
    elements: tplMinusOne(),
  },
  {
    id: 'stamp-number-1',
    name: '1',
    keywords: ['number', 'one', '1'],
    elements: tplNumber(1, { bg: '#e1d4ff', stroke: '#6a3fbf', fg: '#3e1f85' }),
  },
  {
    id: 'stamp-number-2',
    name: '2',
    keywords: ['number', 'two', '2'],
    elements: tplNumber(2, { bg: '#cfe5ff', stroke: '#1e6ec8', fg: '#0f3f7d' }),
  },
  {
    id: 'stamp-number-3',
    name: '3',
    keywords: ['number', 'three', '3'],
    elements: tplNumber(3, { bg: '#d5f4db', stroke: '#2c8a3e', fg: '#184d23' }),
  },
  {
    id: 'stamp-number-4',
    name: '4',
    keywords: ['number', 'four', '4'],
    elements: tplNumber(4, { bg: '#ffddc2', stroke: '#d2641a', fg: '#7a360a' }),
  },
]

// ----- bounds + placement helpers -----

function elementBounds(el) {
  // Approximate AABB for a template element. Lines carry width/height computed
  // from their points; other shapes use their own width/height.
  return {
    minX: el.x,
    minY: el.y,
    maxX: el.x + (el.width || 0),
    maxY: el.y + (el.height || 0),
  }
}

function groupBounds(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of elements) {
    const b = elementBounds(el)
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

function cloneElement(el, { dx, dy, groupIdRemap }) {
  const newGroupIds = (el.groupIds || []).map(gid => {
    if (!groupIdRemap.has(gid)) groupIdRemap.set(gid, rid())
    return groupIdRemap.get(gid)
  })
  const now = Date.now()
  const cloned = {
    ...el,
    id: rid(),
    seed: rseed(),
    versionNonce: rseed(),
    version: 1,
    updated: now,
    groupIds: newGroupIds,
    x: el.x + dx,
    y: el.y + dy,
  }
  // Deep-copy points arrays for line elements so translations never mutate the template.
  if (Array.isArray(el.points)) {
    cloned.points = el.points.map(p => [p[0], p[1]])
  }
  if (el.roundness && typeof el.roundness === 'object') {
    cloned.roundness = { ...el.roundness }
  }
  return cloned
}

export function makeStampElements(stampId, { x, y }) {
  const stamp = STAMPS.find(s => s.id === stampId)
  if (!stamp) throw new Error(`Unknown stamp id: ${stampId}`)

  const b = groupBounds(stamp.elements)
  const centerX = (b.minX + b.maxX) / 2
  const centerY = (b.minY + b.maxY) / 2
  const dx = x - centerX
  const dy = y - centerY

  const groupIdRemap = new Map()
  return stamp.elements.map(el => cloneElement(el, { dx, dy, groupIdRemap }))
}

export const STAMP_SIZE = SIZE
