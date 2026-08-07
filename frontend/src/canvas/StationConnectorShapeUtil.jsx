/* eslint-disable react-refresh/only-export-components */
import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  LineShapeUtil,
  PathBuilder,
  STROKE_SIZES,
  SVGContainer,
  getColorValue,
  getDefaultColorTheme,
  sortByIndex,
  useDefaultColorTheme,
} from 'tldraw'

export const STATION_CONNECTOR_TYPE = 's8-connector'

function connectorPoints(shape) {
  return Object.values(shape.props.points || {})
    .sort(sortByIndex)
    .map(point => ({ x: Number(point.x), y: Number(point.y) }))
}

function getConnectorPath(shape) {
  const points = connectorPoints(shape)
  return shape.props.spline === 'line'
    ? PathBuilder.lineThroughPoints(points, { endOffsets: 0 })
    : PathBuilder.cubicSplineThroughPoints(points, { endOffsets: 0 })
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
  const points = connectorPoints(shape)
  if (points.length < 2) return null

  const path = getConnectorPath(shape)
  const strokeWidth = STROKE_SIZES[shape.props.size] * (shape.props.scale || 1)
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
      <Arrowhead type={shape.props.arrowheadStart} point={start} neighbor={startNeighbor} color={color} strokeWidth={strokeWidth} />
      <Arrowhead type={shape.props.arrowheadEnd} point={end} neighbor={endNeighbor} color={color} strokeWidth={strokeWidth} />
    </>
  )
}

function StationConnectorComponent({ shape }) {
  const theme = useDefaultColorTheme()
  return (
    <SVGContainer style={{ minWidth: 50, minHeight: 50 }}>
      <ConnectorDrawing shape={shape} theme={theme} />
    </SVGContainer>
  )
}

// LineShapeUtil owns the indexed point map, create handles, drag lifecycle,
// snapping, and midpoint insertion. Station 8 only adds arrowheads/rendering.
export class StationConnectorShapeUtil extends LineShapeUtil {
  static type = STATION_CONNECTOR_TYPE
  static migrations = undefined
  static props = {
    ...LineShapeUtil.props,
    arrowheadStart: ArrowShapeArrowheadStartStyle,
    arrowheadEnd: ArrowShapeArrowheadEndStyle,
  }

  getDefaultProps() {
    return {
      ...super.getDefaultProps(),
      spline: 'cubic',
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
    }
  }

  canEdit() {
    return true
  }

  component(shape) {
    return <StationConnectorComponent shape={shape} />
  }

  toSvg(shape, ctx) {
    return (
      <g>
        <ConnectorDrawing shape={shape} theme={getDefaultColorTheme(ctx)} />
      </g>
    )
  }
}
