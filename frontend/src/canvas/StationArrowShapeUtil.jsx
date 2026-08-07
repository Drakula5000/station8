import { cloneElement, isValidElement } from 'react'
import {
  ArrowShapeUtil,
  Box,
  Group2d,
  PathBuilder,
  Rectangle2d,
  SVGContainer,
  STROKE_SIZES,
  Vec,
  getArrowInfo,
  getColorValue,
  getDefaultColorTheme,
  getIndices,
  maybeSnapToGrid,
  useDefaultColorTheme,
} from 'tldraw'

const CONNECTOR_POINTS_KEY = 'connectorPoints'
const START_ID = 'start'
const END_ID = 'end'
const CREATE_PREFIX = 's8c-'

function getConnectorPoints(shape) {
  const raw = shape.meta?.[CONNECTOR_POINTS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((point) => (
    point
    && typeof point.id === 'string'
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  ))
}

function setConnectorPoints(shape, points) {
  return {
    ...shape,
    meta: {
      ...shape.meta,
      [CONNECTOR_POINTS_KEY]: points,
    },
  }
}

function hashPair(leftId, rightId) {
  const input = `${leftId}>${rightId}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${CREATE_PREFIX}${(hash >>> 0).toString(36)}`
}

function getPathData(editor, shape) {
  const info = getArrowInfo(editor, shape)
  if (!info?.isValid) return null

  const controls = getConnectorPoints(shape)
  const nodes = [
    { id: START_ID, point: Vec.From(info.start.point) },
    ...controls.map((control) => ({ id: control.id, point: new Vec(control.x, control.y) })),
    { id: END_ID, point: Vec.From(info.end.point) },
  ]

  return {
    controls,
    info,
    nodes,
    path: PathBuilder.cubicSplineThroughPoints(nodes.map((node) => node.point), { endOffsets: 0 }),
  }
}

function getElementChildren(element) {
  if (!isValidElement(element)) return []
  const children = element.props.children
  return Array.isArray(children) ? children : [children]
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5))
}

function moveCanvasLabel(label, geometry, position) {
  if (!isValidElement(label)) return label
  const center = geometry.interpolateAlongEdge(clamp01(position))
  return cloneElement(label, {
    style: {
      ...(label.props.style || {}),
      transform: `translate(${center.x}px, ${center.y}px)`,
    },
  })
}

function moveExportLabel(label, geometry, position) {
  if (!isValidElement(label)) return label
  const bounds = label.props.bounds
  if (!bounds || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) return label
  const center = geometry.interpolateAlongEdge(clamp01(position))
  return cloneElement(label, {
    bounds: new Box(center.x - bounds.w / 2, center.y - bounds.h / 2, bounds.w, bounds.h),
  })
}

function Arrowhead({ type, point, neighbor, color, strokeWidth, scale }) {
  if (!type || type === 'none') return null

  const angle = Math.atan2(point.y - neighbor.y, point.x - neighbor.x) * 180 / Math.PI
  const length = Math.max(9 * scale, strokeWidth * 4)
  const half = Math.max(4.5 * scale, length * 0.42)
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }

  let head
  switch (type) {
    case 'triangle':
      head = <polygon points={`0,0 ${-length},${-half} ${-length},${half}`} fill={color} stroke={color} />
      break
    case 'dot':
      head = <circle cx={0} cy={0} r={half * 0.72} fill={color} stroke={color} />
      break
    case 'diamond':
      head = <polygon points={`0,0 ${-length * 0.5},${-half} ${-length},0 ${-length * 0.5},${half}`} fill={color} stroke={color} />
      break
    case 'square':
      head = <rect x={-half} y={-half} width={half * 2} height={half * 2} rx={scale} fill={color} stroke={color} />
      break
    case 'bar':
    case 'pipe':
      head = <line x1={0} y1={-half} x2={0} y2={half} {...common} />
      break
    case 'arrow':
    default:
      head = <path d={`M ${-length} ${-half} L 0 0 L ${-length} ${half}`} fill="none" {...common} />
      break
  }

  return (
    <g transform={`translate(${point.x} ${point.y}) rotate(${angle})`}>
      {head}
    </g>
  )
}

function ConnectorSvg({ shape, pathData, theme }) {
  const strokeWidth = STROKE_SIZES[shape.props.size] * shape.props.scale
  const color = getColorValue(theme, shape.props.color, 'solid')
  const body = pathData.path.toSvg({
    style: shape.props.dash,
    strokeWidth,
    randomSeed: shape.id,
    props: {
      stroke: color,
      fill: 'none',
    },
  })

  const nodePoints = pathData.nodes.map((node) => node.point)
  const start = nodePoints[0]
  const startNeighbor = nodePoints[1]
  const end = nodePoints[nodePoints.length - 1]
  const endNeighbor = nodePoints[nodePoints.length - 2]

  return (
    <>
      {body}
      <Arrowhead
        type={shape.props.arrowheadStart}
        point={start}
        neighbor={startNeighbor}
        color={color}
        strokeWidth={strokeWidth}
        scale={shape.props.scale}
      />
      <Arrowhead
        type={shape.props.arrowheadEnd}
        point={end}
        neighbor={endNeighbor}
        color={color}
        strokeWidth={strokeWidth}
        scale={shape.props.scale}
      />
    </>
  )
}

export class StationArrowShapeUtil extends ArrowShapeUtil {
  getHandles(shape) {
    if (shape.props.kind !== 'arc') return super.getHandles(shape)

    const info = getArrowInfo(this.editor, shape)
    if (!info?.isValid) return super.getHandles(shape)

    const nativeHandles = super.getHandles(shape)
    const startHandle = nativeHandles.find((handle) => handle.id === START_ID)
    const endHandle = nativeHandles.find((handle) => handle.id === END_ID)
    if (!startHandle || !endHandle) return nativeHandles

    const controls = getConnectorPoints(shape)
    const handles = []

    if (controls.length === 0) {
      handles.push(
        { ...startHandle },
        {
          id: hashPair(START_ID, END_ID),
          type: 'create',
          x: info.middle.x,
          y: info.middle.y,
          canSnap: true,
        },
        { ...endHandle },
      )
    } else {
      const pathData = getPathData(this.editor, shape)
      if (!pathData) return nativeHandles
      const segments = pathData.path.toGeometry().getSegments()

      handles.push({ ...startHandle })
      for (let i = 0; i < pathData.nodes.length - 1; i += 1) {
        const left = pathData.nodes[i]
        const right = pathData.nodes[i + 1]
        const segment = segments[i]
        const midpoint = segment?.interpolateAlongEdge
          ? segment.interpolateAlongEdge(0.5)
          : Vec.Med(left.point, right.point)

        handles.push({
          id: hashPair(left.id, right.id),
          type: 'create',
          x: midpoint.x,
          y: midpoint.y,
          canSnap: true,
        })

        if (i < controls.length) {
          const control = controls[i]
          handles.push({
            id: control.id,
            type: 'vertex',
            x: control.x,
            y: control.y,
            canSnap: true,
          })
        }
      }
      handles.push({ ...endHandle })
    }

    const indices = getIndices(handles.length)
    return handles.map((handle, index) => ({ ...handle, index: indices[index] }))
  }

  onHandleDragStart(shape, { handle }) {
    if (shape.props.kind !== 'arc') return undefined
    const controls = getConnectorPoints(shape)
    if (controls.some((control) => control.id === handle.id)) return undefined
    if (!String(handle.id).startsWith(CREATE_PREFIX)) return undefined

    const nodeIds = [START_ID, ...controls.map((control) => control.id), END_ID]
    const insertAt = nodeIds.findIndex((leftId, index) => (
      index < nodeIds.length - 1 && hashPair(leftId, nodeIds[index + 1]) === handle.id
    ))
    if (insertAt < 0) return undefined

    const nextControls = [...controls]
    nextControls.splice(insertAt, 0, {
      id: handle.id,
      x: handle.x,
      y: handle.y,
    })

    return {
      ...setConnectorPoints(shape, nextControls),
      props: {
        ...shape.props,
        kind: 'arc',
        bend: 0,
      },
    }
  }

  onHandleDrag(shape, info) {
    const handleId = String(info.handle.id)
    if (handleId === START_ID || handleId === END_ID || shape.props.kind !== 'arc') {
      return super.onHandleDrag(shape, info)
    }

    const controls = getConnectorPoints(shape)
    const controlIndex = controls.findIndex((control) => control.id === handleId)
    if (controlIndex >= 0) {
      const point = maybeSnapToGrid(new Vec(info.handle.x, info.handle.y), this.editor)
      const nextControls = controls.map((control, index) => (
        index === controlIndex ? { ...control, x: point.x, y: point.y } : control
      ))
      return setConnectorPoints(shape, nextControls)
    }

    if (handleId.startsWith(CREATE_PREFIX)) {
      const inserted = this.onHandleDragStart(shape, info)
      if (inserted) {
        const nextControls = getConnectorPoints(inserted).map((control) => (
          control.id === handleId
            ? { ...control, x: info.handle.x, y: info.handle.y }
            : control
        ))
        return setConnectorPoints(inserted, nextControls)
      }
    }

    return super.onHandleDrag(shape, info)
  }

  getGeometry(shape) {
    const controls = getConnectorPoints(shape)
    if (shape.props.kind !== 'arc' || controls.length === 0) return super.getGeometry(shape)

    const pathData = getPathData(this.editor, shape)
    if (!pathData) return super.getGeometry(shape)
    const bodyGeometry = pathData.path.toGeometry()

    const baseGeometry = super.getGeometry(shape)
    const baseLabel = baseGeometry?.children?.find((child) => child.isLabel)
    if (!baseLabel) return bodyGeometry

    const center = bodyGeometry.interpolateAlongEdge(clamp01(shape.props.labelPosition))
    const bounds = baseLabel.bounds
    const labelGeometry = new Rectangle2d({
      x: center.x - bounds.w / 2,
      y: center.y - bounds.h / 2,
      width: bounds.w,
      height: bounds.h,
      isFilled: true,
      isLabel: true,
    })

    return new Group2d({ children: [bodyGeometry, labelGeometry] })
  }

  indicator(shape) {
    const controls = getConnectorPoints(shape)
    if (shape.props.kind !== 'arc' || controls.length === 0) return super.indicator(shape)

    const pathData = getPathData(this.editor, shape)
    if (!pathData) return super.indicator(shape)
    const strokeWidth = STROKE_SIZES[shape.props.size] * shape.props.scale
    return pathData.path.toSvg({
      style: shape.props.dash === 'draw' ? 'draw' : 'solid',
      strokeWidth: 1,
      passes: 1,
      randomSeed: shape.id,
      offset: 0,
      roundness: strokeWidth * 2,
      props: { strokeWidth: undefined },
    })
  }

  component(shape) {
    // ArrowShapeUtil's component uses hooks. Call it on every render so the
    // hook order stays stable when a connector gains its first extra point.
    const base = super.component(shape)
    const theme = useDefaultColorTheme()
    const controls = getConnectorPoints(shape)
    if (shape.props.kind !== 'arc' || controls.length === 0) return base

    const pathData = getPathData(this.editor, shape)
    if (!pathData) return base
    const geometry = pathData.path.toGeometry()
    const baseLabel = getElementChildren(base)[1]
    const label = moveCanvasLabel(baseLabel, geometry, shape.props.labelPosition)

    return (
      <>
        <SVGContainer style={{ minWidth: 50, minHeight: 50 }}>
          <ConnectorSvg shape={shape} pathData={pathData} theme={theme} />
        </SVGContainer>
        {label}
      </>
    )
  }

  toSvg(shape, ctx) {
    // Let the stock exporter register its normal defs and build the label;
    // then replace only the connector body when multipoint mode is active.
    const base = super.toSvg(shape, ctx)
    const controls = getConnectorPoints(shape)
    if (shape.props.kind !== 'arc' || controls.length === 0) return base

    const pathData = getPathData(this.editor, shape)
    if (!pathData) return base
    const geometry = pathData.path.toGeometry()
    const theme = getDefaultColorTheme(ctx)
    const baseLabel = getElementChildren(base)[1]
    const label = moveExportLabel(baseLabel, geometry, shape.props.labelPosition)

    return (
      <g transform={base.props.transform}>
        <ConnectorSvg shape={shape} pathData={pathData} theme={theme} />
        {label}
      </g>
    )
  }
}
