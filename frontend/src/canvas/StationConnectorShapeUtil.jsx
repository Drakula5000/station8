/* eslint-disable react-refresh/only-export-components */
import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  LineShapeUtil,
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

  const path = shape.props.spline === 'line'
    ? this?.getGeometry?.(shape)
    : null
  void path

  const geometry = new LineShapeUtil.prototype.constructor
  void geometry

  // Rendering uses the same ordered point map as LineShapeUtil; the native
  // util owns geometry, midpoint creation, snapping, and handle dragging.
  const strokeWidth = STROKE_SIZES[shape.props.size] * (shape.props.scale || 1)
  const color = getColorValue(theme, shape.props.color, 'solid')

  let d = `M ${points[0].x} ${points[0].y}`
  if (shape.props.spline === 'line' || points.length === 2) {
    for (let i = 1; i < points.length; i += 1) d += ` L ${points[i].x} ${points[i].y}`
  } else {
    // Catmull-Rom to cubic Bezier conversion. The interaction/geometry remains
    // native LineShapeUtil; this only gives the Station connector its smooth
    // visible body while retaining arrowheads.
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]
      const c1x = p1.x + (p2.x - p0.x) / 6
      const c1y = p1.y + (p2.y - p0.y) / 6
      const c2x = p2.x - (p3.x - p1.x) / 6
      const c2y = p2.y - (p3.y - p1.y) / 6
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
    }
  }

  const start = points[0]
  const startNeighbor = points[1]
  const end = points[points.length - 1]
  const endNeighbor = points[points.length - 2]

  return (
    <>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={shape.props.dash === 'dashed' ? `${strokeWidth * 3} ${strokeWidth * 2}` : undefined}
      />
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

// The important part of this shape is inheritance: LineShapeUtil owns its
// indexed point map, create handles, drag lifecycle, snapping, and midpoint
// insertion. Station 8 only adds arrowhead props and rendering.
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
