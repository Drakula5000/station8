import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  PathBuilder,
  ShapeUtil,
  STROKE_SIZES,
  SVGContainer,
  T,
  ZERO_INDEX_KEY,
  getColorValue,
  getDefaultColorTheme,
  getIndicesAbove,
  useDefaultColorTheme,
  vecModelValidator,
} from 'tldraw'
import {
  connectorMidpoint,
  insertConnectorPoint,
  moveConnectorPoint,
  normalizeConnectorPoints,
} from './stationConnectorPoints'

export const STATION_CONNECTOR_TYPE = 's8-connector'

function getConnectorPath(points) {
  const normalized = normalizeConnectorPoints(points)
  return normalized.length <= 2
    ? PathBuilder.lineThroughPoints(normalized, { endOffsets: 0 })
    : PathBuilder.cubicSplineThroughPoints(normalized, { endOffsets: 0 })
}

function parsePointHandleId(id, pointCount) {
  if (id === 'start') return 0
  if (id === 'end') return pointCount - 1
  const match = /^point:(\d+)$/.exec(String(id))
  return match ? Number(match[1]) : null
}

function parseInsertHandleId(id) {
  const match = /^insert:(\d+)$/.exec(String(id))
  return match ? Number(match[1]) : null
}

function Arrowhead({ type, point, neighbor, color, strokeWidth }) {
  if (!type || type === 'none' || !point || !neighbor) return null

  const angle = Math.atan2(point.y - neighbor.y, point.x - neighbor.x) * 180 / Math.PI
  const length = Math.max(9, strokeWidth * 4)
  const half = Math.max(4.5, length * 0.42)
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
    case 'inverted':
      head = <polygon points={`${-length},0 0,${-half} 0,${half}`} fill={color} stroke={color} />
      break
    case 'dot':
      head = <circle cx={-half * 0.3} cy={0} r={half * 0.72} fill={color} stroke={color} />
      break
    case 'diamond':
      head = <polygon points={`0,0 ${-length * 0.5},${-half} ${-length},0 ${-length * 0.5},${half}`} fill={color} stroke={color} />
      break
    case 'square':
      head = <rect x={-half * 2} y={-half} width={half * 2} height={half * 2} rx={1} fill={color} stroke={color} />
      break
    case 'bar':
    case 'pipe':
      head = <line x1={-strokeWidth} y1={-half} x2={-strokeWidth} y2={half} {...common} />
      break
    case 'arrow':
    default:
      head = <path d={`M ${-length} ${-half} L 0 0 L ${-length} ${half}`} fill="none" {...common} />
      break
  }

  return <g transform={`translate(${point.x} ${point.y}) rotate(${angle})`}>{head}</g>
}

function ConnectorDrawing({ shape, theme }) {
  const points = normalizeConnectorPoints(shape.props.points)
  const path = getConnectorPath(points)
  const strokeWidth = STROKE_SIZES[shape.props.size]
  const color = getColorValue(theme, shape.props.color, 'solid')
  const body = path.toSvg({
    style: shape.props.dash,
    strokeWidth,
    randomSeed: shape.id,
    props: { stroke: color, fill: 'none' },
  })

  const start = points[0]
  const startNeighbor = points[1]
  const end = points[points.length - 1]
  const endNeighbor = points[points.length - 2]

  return (
    <>
      {body}
      <Arrowhead
        type={shape.props.arrowheadStart}
        point={start}
        neighbor={startNeighbor}
        color={color}
        strokeWidth={strokeWidth}
      />
      <Arrowhead
        type={shape.props.arrowheadEnd}
        point={end}
        neighbor={endNeighbor}
        color={color}
        strokeWidth={strokeWidth}
      />
    </>
  )
}

function StationConnectorComponent({ shape }) {
  const theme = useDefaultColorTheme()
  return (
    <SVGContainer style={{ minWidth: 32, minHeight: 32 }}>
      <ConnectorDrawing shape={shape} theme={theme} />
    </SVGContainer>
  )
}

export class StationConnectorShapeUtil extends ShapeUtil {
  static type = STATION_CONNECTOR_TYPE
  static props = {
    points: T.arrayOf(vecModelValidator),
    color: DefaultColorStyle,
    dash: DefaultDashStyle,
    size: DefaultSizeStyle,
    arrowheadStart: ArrowShapeArrowheadStartStyle,
    arrowheadEnd: ArrowShapeArrowheadEndStyle,
  }

  getDefaultProps() {
    return {
      points: [{ x: 0, y: 0 }, { x: 160, y: 0 }],
      color: 'black',
      dash: 'draw',
      size: 'm',
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
    }
  }

  canResize() {
    return false
  }

  hideResizeHandles() {
    return true
  }

  hideRotateHandle() {
    return true
  }

  hideSelectionBoundsBg() {
    return true
  }

  hideSelectionBoundsFg() {
    return true
  }

  getGeometry(shape) {
    return getConnectorPath(shape.props.points).toGeometry()
  }

  getHandles(shape) {
    const points = normalizeConnectorPoints(shape.props.points)
    const geometry = getConnectorPath(points).toGeometry()
    const segments = typeof geometry.getSegments === 'function' ? geometry.getSegments() : []
    const handles = []

    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      if (pointIndex > 0) {
        const segmentIndex = pointIndex - 1
        const segment = segments[segmentIndex]
        const midpoint = segment?.interpolateAlongEdge
          ? segment.interpolateAlongEdge(0.5)
          : connectorMidpoint(points[segmentIndex], points[pointIndex])
        handles.push({
          id: `insert:${segmentIndex}`,
          type: 'create',
          x: midpoint.x,
          y: midpoint.y,
          snapType: 'align',
        })
      }

      handles.push({
        id: pointIndex === 0 ? 'start' : pointIndex === points.length - 1 ? 'end' : `point:${pointIndex}`,
        type: 'vertex',
        x: points[pointIndex].x,
        y: points[pointIndex].y,
        snapType: 'align',
      })
    }

    const indices = [ZERO_INDEX_KEY, ...getIndicesAbove(ZERO_INDEX_KEY, handles.length - 1)]
    return handles.map((handle, index) => ({ ...handle, index: indices[index] }))
  }

  onHandleDragStart(shape, info) {
    const segmentIndex = parseInsertHandleId(info.handle.id)
    if (segmentIndex === null) return undefined
    return {
      ...shape,
      props: {
        ...shape.props,
        points: insertConnectorPoint(shape.props.points, segmentIndex, info.handle),
      },
    }
  }

  onHandleDrag(shape, info) {
    const points = normalizeConnectorPoints(shape.props.points)
    const insertSegmentIndex = parseInsertHandleId(info.handle.id)
    const pointIndex = insertSegmentIndex === null
      ? parsePointHandleId(info.handle.id, points.length)
      : insertSegmentIndex + 1

    if (pointIndex === null) return shape
    return {
      ...shape,
      props: {
        ...shape.props,
        points: moveConnectorPoint(points, pointIndex, info.handle),
      },
    }
  }

  component(shape) {
    return <StationConnectorComponent shape={shape} />
  }

  indicator(shape) {
    return <path d={getConnectorPath(shape.props.points).toD()} fill="none" />
  }

  toSvg(shape, ctx) {
    return (
      <g>
        <ConnectorDrawing shape={shape} theme={getDefaultColorTheme(ctx)} />
      </g>
    )
  }
}
