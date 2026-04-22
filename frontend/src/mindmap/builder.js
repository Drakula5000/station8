// Mind-map auto-layout helper for Excalidraw.
//
// Exports:
//   buildMindMap(tree, { x, y, layout })  -> Excalidraw element array
//   parseIndentedText(text)               -> tree object
//
// Each node is a rounded rectangle with a bound text child. Parents connect
// to children via arrows whose endpoints are bound through boundElements +
// startBinding / endBinding.

// --- Node style palette ------------------------------------------------------

const NODE_STYLES = {
  root:   { bg: '#6a3fbf', stroke: '#3f2487', text: '#ffffff', width: 220, height: 70, fontSize: 22 },
  first:  { bg: '#cfe5ff', stroke: '#1e6ec8', text: '#0a2a4a', width: 180, height: 56, fontSize: 18 },
  deep:   { bg: '#f3f3f3', stroke: '#555555', text: '#1a1a1a', width: 160, height: 48, fontSize: 16 },
}

const H_GAP = 90   // horizontal gap between depth levels
const V_GAP = 22   // vertical gap between sibling subtrees
const ARROW_STROKE = '#555555'

// --- id helpers --------------------------------------------------------------

function rid() {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)
}

function rseed() {
  return Math.floor(Math.random() * 1e9)
}

function styleForDepth(depth) {
  if (depth === 0) return NODE_STYLES.root
  if (depth === 1) return NODE_STYLES.first
  return NODE_STYLES.deep
}

// --- element factories -------------------------------------------------------

function makeNode({ x, y, label, depth }) {
  const style = styleForDepth(depth)
  const w = style.width
  const h = style.height
  const now = Date.now()
  const rectId = rid()
  const textId = rid()

  const rect = {
    id: rectId,
    type: 'rectangle',
    x, y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: style.stroke,
    backgroundColor: style.bg,
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: rseed(),
    version: 1,
    versionNonce: rseed(),
    isDeleted: false,
    boundElements: [{ type: 'text', id: textId }],
    updated: now,
    link: null,
    locked: false,
  }

  const text = {
    id: textId,
    type: 'text',
    x: x + w / 2,
    y: y + h / 2 - style.fontSize / 2,
    width: w - 24,
    height: style.fontSize + 6,
    angle: 0,
    strokeColor: style.text,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
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
    text: label,
    fontSize: style.fontSize,
    fontFamily: 2,
    textAlign: 'center',
    verticalAlign: 'middle',
    baseline: Math.round(style.fontSize * 0.8),
    containerId: rectId,
    originalText: label,
    lineHeight: 1.25,
    autoResize: true,
  }

  return { rect, text }
}

function makeArrow({ fromId, toId, fromBox, toBox }) {
  // Anchor: centers of the two rectangles. Excalidraw's arrow x/y is its
  // start point; points[] are relative to that.
  const sx = fromBox.x + fromBox.width / 2
  const sy = fromBox.y + fromBox.height / 2
  const ex = toBox.x + toBox.width / 2
  const ey = toBox.y + toBox.height / 2
  const now = Date.now()

  return {
    id: rid(),
    type: 'arrow',
    x: sx,
    y: sy,
    width: Math.abs(ex - sx),
    height: Math.abs(ey - sy),
    angle: 0,
    strokeColor: ARROW_STROKE,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: rseed(),
    version: 1,
    versionNonce: rseed(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    points: [[0, 0], [ex - sx, ey - sy]],
    lastCommittedPoint: null,
    startBinding: { elementId: fromId, focus: 0, gap: 4 },
    endBinding:   { elementId: toId,   focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
  }
}

// Attach a bound-arrow reference onto a rectangle's boundElements list
// (Excalidraw uses this to know an arrow is docked to the shape).
function bindArrowToShape(shape, arrowId) {
  const list = Array.isArray(shape.boundElements) ? shape.boundElements.slice() : []
  list.push({ type: 'arrow', id: arrowId })
  shape.boundElements = list
}

// --- layout: horizontal (Reingold-Tilford-ish) -------------------------------

// Count the number of leaves in a subtree; used to size vertical slots.
function leafCount(node) {
  if (!node.children || node.children.length === 0) return 1
  let n = 0
  for (const c of node.children) n += leafCount(c)
  return n
}

// Pick the average "row height" of nodes at a depth so vertical spacing looks
// balanced regardless of which level dominates.
function slotHeightForDepth(depth) {
  return styleForDepth(depth).height + V_GAP
}

// Recursively place nodes. Returns the vertical span the subtree occupies.
function layoutHorizontal(node, depth, xLeft, yTop, out) {
  const style = styleForDepth(depth)
  const leaves = leafCount(node)
  const slot = slotHeightForDepth(Math.max(depth, 1))
  const subtreeHeight = leaves * slot

  // Vertically center this node inside its subtree band.
  const nodeX = xLeft
  const nodeY = yTop + subtreeHeight / 2 - style.height / 2

  const { rect, text } = makeNode({ x: nodeX, y: nodeY, label: node.label, depth })
  out.elements.push(rect, text)

  const selfInfo = {
    id: rect.id,
    rect,
    box: { x: nodeX, y: nodeY, width: style.width, height: style.height },
  }

  if (node.children && node.children.length) {
    const childX = xLeft + style.width + H_GAP
    let cursorY = yTop
    for (const child of node.children) {
      const childLeaves = leafCount(child)
      const childSlot = slotHeightForDepth(Math.max(depth + 1, 1))
      const childHeight = childLeaves * childSlot

      const childInfo = layoutHorizontal(child, depth + 1, childX, cursorY, out)

      const arrow = makeArrow({
        fromId: selfInfo.id,
        toId: childInfo.id,
        fromBox: selfInfo.box,
        toBox: childInfo.box,
      })
      out.elements.push(arrow)
      bindArrowToShape(selfInfo.rect, arrow.id)
      bindArrowToShape(childInfo.rect, arrow.id)

      cursorY += childHeight
    }
  }

  return selfInfo
}

// --- layout: radial ----------------------------------------------------------

function layoutRadial(node, depth, cx, cy, angleStart, angleEnd, out, parentInfo) {
  const style = styleForDepth(depth)
  const nodeX = cx - style.width / 2
  const nodeY = cy - style.height / 2
  const { rect, text } = makeNode({ x: nodeX, y: nodeY, label: node.label, depth })
  out.elements.push(rect, text)

  const info = {
    id: rect.id,
    rect,
    box: { x: nodeX, y: nodeY, width: style.width, height: style.height },
  }

  if (parentInfo) {
    const arrow = makeArrow({
      fromId: parentInfo.id,
      toId: info.id,
      fromBox: parentInfo.box,
      toBox: info.box,
    })
    out.elements.push(arrow)
    bindArrowToShape(parentInfo.rect, arrow.id)
    bindArrowToShape(info.rect, arrow.id)
  }

  const children = node.children || []
  if (!children.length) return info

  // Distribute children in the given angular range; deeper rings sit farther
  // from centre and get narrower arcs per child.
  const ringRadius = (depth + 1) * 260
  const totalAngle = angleEnd - angleStart
  const per = totalAngle / children.length

  children.forEach((child, i) => {
    const a0 = angleStart + i * per
    const a1 = a0 + per
    const mid = (a0 + a1) / 2
    const ccx = cx + Math.cos(mid) * ringRadius
    const ccy = cy + Math.sin(mid) * ringRadius
    // Shrink each child's arc so grandchildren don't collide with siblings.
    const shrink = Math.min(per, Math.PI / 2)
    layoutRadial(child, depth + 1, ccx, ccy, mid - shrink / 2, mid + shrink / 2, out, info)
  })

  return info
}

// --- public API --------------------------------------------------------------

export function buildMindMap(tree, opts = {}) {
  if (!tree || typeof tree !== 'object' || !tree.label) {
    throw new Error('buildMindMap: tree must be an object with a label')
  }
  const { x = 0, y = 0, layout = 'horizontal' } = opts
  const out = { elements: [] }

  if (layout === 'radial') {
    layoutRadial(tree, 0, x, y, 0, Math.PI * 2, out, null)
  } else {
    const leaves = leafCount(tree)
    const slot = slotHeightForDepth(1)
    const totalHeight = leaves * slot
    layoutHorizontal(tree, 0, x, y - totalHeight / 2, out)
  }

  return out.elements
}

// --- indented-text parser ----------------------------------------------------

// Convert indented text into the recursive tree structure. 2 spaces OR 1 tab
// equals one level of nesting. Blank lines are ignored.
export function parseIndentedText(text) {
  if (typeof text !== 'string') throw new Error('parseIndentedText: expected string')
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (!lines.length) return null

  // Measure indent: tabs count as one level; spaces counted in pairs.
  const parsed = lines.map(line => {
    const match = line.match(/^([\t ]*)(.*)$/)
    const indent = match[1]
    const label = match[2].trim()
    let level = 0
    for (let i = 0; i < indent.length; i++) {
      if (indent[i] === '\t') level += 1
      else {
        // count consecutive spaces in pairs
        let spaces = 0
        while (i < indent.length && indent[i] === ' ') { spaces++; i++ }
        i--
        level += Math.floor(spaces / 2)
      }
    }
    return { level, label }
  })

  // Normalise: the first non-empty line's level becomes 0.
  const base = parsed[0].level
  for (const p of parsed) p.level -= base

  const root = { label: parsed[0].label, children: [] }
  // Stack holds { node, level } pairs so a new line attaches under the
  // nearest ancestor whose level is exactly one less.
  const stack = [{ node: root, level: 0 }]

  for (let i = 1; i < parsed.length; i++) {
    const { level, label } = parsed[i]
    const node = { label, children: [] }
    // Pop until we find a parent with level < current.
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1].node : root
    parent.children.push(node)
    stack.push({ node, level })
  }

  return root
}
