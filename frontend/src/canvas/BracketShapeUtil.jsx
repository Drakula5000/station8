import {
  BaseBoxShapeUtil,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  Rectangle2d,
  resizeBox,
  SVGContainer,
  StateNode,
  Vec,
  createShapeId,
  maybeSnapToGrid,
} from 'tldraw'
import { T } from '@tldraw/validate'

const BRACKET_TYPES = new Set(['square', 'curly', 'round'])
const BRACKET_DEPTH = 48
const STROKE_WIDTHS = { s: 1.5, m: 2.5, l: 3.5, xl: 5 }

function normalizeBracketType(value) {
  return BRACKET_TYPES.has(value) ? value : 'square'
}

function getBracketPath(type, height) {
  // A left bracket has a fixed shallow depth. `shape.props.w` may retain a
  // wider drag box from an older paired-bracket version, but the glyph itself
  // must never claim that empty space as selectable geometry.
  const inset = Math.min(Math.max(14, BRACKET_DEPTH * 0.12), BRACKET_DEPTH * 0.32)
  const middle = height / 2

  if (type === 'round') {
    return `M ${inset} 0 C 0 ${height * 0.08}, 0 ${height * 0.26}, 0 ${middle} C 0 ${height * 0.74}, 0 ${height * 0.92}, ${inset} ${height}`
  }

  if (type === 'curly') {
    const pinch = Math.min(Math.max(inset * 0.6, 10), BRACKET_DEPTH * 0.18)
    return [
      `M ${inset} 0`,
      `C 0 ${height * 0.05}, 0 ${height * 0.22}, ${inset} ${height * 0.31}`,
      `C ${inset + pinch} ${height * 0.39}, ${inset + pinch} ${height * 0.46}, ${inset * 2} ${middle}`,
      `C ${inset + pinch} ${height * 0.54}, ${inset + pinch} ${height * 0.61}, ${inset} ${height * 0.69}`,
      `C 0 ${height * 0.78}, 0 ${height * 0.95}, ${inset} ${height}`,
    ].join(' ')
  }

  return `M ${inset} 0 H 0 V ${height} H ${inset}`
}

function getBracketGeometryWidth(type, size) {
  const inset = Math.min(Math.max(14, BRACKET_DEPTH * 0.12), BRACKET_DEPTH * 0.32)
  const depth = type === 'curly' ? inset * 2 : inset
  return depth + (STROKE_WIDTHS[size] ?? STROKE_WIDTHS.m)
}

function getBracketTransform(shape) {
  const width = getBracketGeometryWidth(normalizeBracketType(shape.props.bracket), shape.props.size)
  if (!shape.props.flipX && !shape.props.flipY) return undefined
  return `translate(${shape.props.flipX ? width : 0} ${shape.props.flipY ? shape.props.h : 0}) scale(${shape.props.flipX ? -1 : 1} ${shape.props.flipY ? -1 : 1})`
}

function getStrokeDasharray(dash) {
  if (dash === 'dashed') return '12 8'
  if (dash === 'dotted') return '2 7'
  return undefined
}

function renderBracketPath(shape) {
  const { bracket, dash, h, size } = shape.props
  const path = getBracketPath(normalizeBracketType(bracket), h)
  const strokeWidth = STROKE_WIDTHS[size] ?? STROKE_WIDTHS.m
  const strokeDasharray = getStrokeDasharray(dash)
  return (
    <g transform={getBracketTransform(shape)}>
      <path
        className="s8-bracket-path"
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

// A single left bracket marks a region without creating an opaque card. The
// three variants are purpose-built canvas shapes, so they scale, rotate,
// export, recolor, and remain selectable as one object.
export class BracketShapeUtil extends BaseBoxShapeUtil {
  static type = 'bracket'

  static props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    bracket: T.literalEnum('square', 'curly', 'round'),
    flipX: T.boolean.optional(),
    flipY: T.boolean.optional(),
    color: DefaultColorStyle,
    dash: DefaultDashStyle,
    size: DefaultSizeStyle,
  }

  getDefaultProps() {
    return {
      w: 48,
      h: 160,
      bracket: 'square',
      flipX: false,
      flipY: false,
      color: 'black',
      dash: 'solid',
      size: 'm',
    }
  }

  onResize(shape, info) {
    const resized = resizeBox(shape, info)
    return {
      ...resized,
      props: {
        ...resized.props,
        flipX: Boolean(info.initialShape.props.flipX) !== (info.scaleX < 0),
        flipY: Boolean(info.initialShape.props.flipY) !== (info.scaleY < 0),
      },
    }
  }

  getGeometry(shape) {
    const bracket = normalizeBracketType(shape.props.bracket)
    return new Rectangle2d({
      width: getBracketGeometryWidth(bracket, shape.props.size),
      height: shape.props.h,
      isFilled: false,
    })
  }

  component(shape) {
    return (
      <SVGContainer>
        {renderBracketPath(shape)}
      </SVGContainer>
    )
  }

  indicator(shape) {
    return <rect width={getBracketGeometryWidth(normalizeBracketType(shape.props.bracket), shape.props.size)} height={shape.props.h} />
  }

  toSvg(shape) {
    return renderBracketPath(shape)
  }
}

export class BracketShapeTool extends StateNode {
  static id = 'bracket'
  static initial = 'idle'

  static children() {
    return [BracketIdle, BracketPointing]
  }

  bracketType = 'square'

  onEnter(info) {
    this.bracketType = normalizeBracketType(info?.bracket || this.bracketType)
  }
}

class BracketIdle extends StateNode {
  static id = 'idle'

  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  onPointerDown(info) {
    this.parent.transition('pointing', info)
  }

  onCancel() {
    this.editor.setCurrentTool('select')
  }
}

class BracketPointing extends StateNode {
  static id = 'pointing'

  onPointerMove(info) {
    if (!this.editor.inputs.getIsDragging()) return

    const origin = maybeSnapToGrid(this.editor.inputs.getOriginPagePoint(), this.editor)
    const id = createShapeId()
    const creatingMarkId = this.editor.markHistoryStoppingPoint(`creating_bracket:${id}`)
    this.editor.createShape({
      id,
      type: 'bracket',
      x: origin.x,
      y: origin.y,
      props: getBracketCreationProps(this.editor, this.parent.bracketType, { w: 1, h: 1 }),
    })
    this.editor.select(id)
    this.editor.setCurrentTool('select.resizing', {
      ...info,
      target: 'selection',
      handle: 'bottom_right',
      isCreating: true,
      creatingMarkId,
      creationCursorOffset: { x: 1, y: 1 },
      onInteractionEnd: 'bracket',
    })
  }

  onPointerUp() {
    this.complete()
  }

  onCancel() {
    this.parent.transition('idle')
  }

  onComplete() {
    this.complete()
  }

  onInterrupt() {
    this.parent.transition('idle')
  }

  complete() {
    const size = { w: 48, h: 160 }
    const origin = this.editor.inputs.getOriginPagePoint()
    const point = maybeSnapToGrid(
      new Vec(origin.x - size.w / 2, origin.y - size.h / 2),
      this.editor,
    )
    const id = createShapeId()
    this.editor.markHistoryStoppingPoint(`creating_bracket:${id}`)
    this.editor.createShape({
      id,
      type: 'bracket',
      x: point.x,
      y: point.y,
      props: getBracketCreationProps(this.editor, this.parent.bracketType, size),
    })
    this.editor.select(id)
    if (this.editor.getInstanceState().isToolLocked) {
      this.parent.transition('idle')
    } else {
      this.editor.setCurrentTool('select')
    }
  }
}

function getBracketCreationProps(editor, bracket, size) {
  return {
    ...size,
    bracket: normalizeBracketType(bracket),
    color: editor.getStyleForNextShape(DefaultColorStyle),
    dash: editor.getStyleForNextShape(DefaultDashStyle),
    size: editor.getStyleForNextShape(DefaultSizeStyle),
  }
}
