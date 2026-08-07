import { StateNode, Vec, createShapeId, getIndices } from 'tldraw'
import { STATION_CONNECTOR_TYPE } from './StationConnectorShapeUtil'

export const STATION_CONNECTOR_TOOL = 's8-connector'

export class StationConnectorTool extends StateNode {
  static id = STATION_CONNECTOR_TOOL

  shapeId = null
  startPoint = null
  endIndex = null

  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  onPointerDown() {
    const point = this.editor.inputs.getCurrentPagePoint()
    const id = createShapeId()
    const [startIndex, endIndex] = getIndices(2)

    this.editor.markHistoryStoppingPoint('create connector')
    this.editor.createShape({
      id,
      type: STATION_CONNECTOR_TYPE,
      x: point.x,
      y: point.y,
      props: {
        spline: 'cubic',
        scale: 1,
        points: {
          [startIndex]: { id: startIndex, index: startIndex, x: 0, y: 0 },
          [endIndex]: { id: endIndex, index: endIndex, x: 0, y: 0 },
        },
      },
    })

    this.shapeId = id
    this.startPoint = new Vec(point.x, point.y)
    this.endIndex = endIndex
    this.editor.select(id)
  }

  onPointerMove() {
    if (!this.shapeId || !this.startPoint || !this.endIndex) return
    const current = this.editor.inputs.getCurrentPagePoint()
    const shape = this.editor.getShape(this.shapeId)
    if (!shape) return

    this.editor.updateShape({
      id: this.shapeId,
      type: STATION_CONNECTOR_TYPE,
      props: {
        points: {
          ...shape.props.points,
          [this.endIndex]: {
            id: this.endIndex,
            index: this.endIndex,
            x: current.x - this.startPoint.x,
            y: current.y - this.startPoint.y,
          },
        },
      },
    })
  }

  onPointerUp() {
    if (!this.shapeId || !this.startPoint) return
    const current = this.editor.inputs.getCurrentPagePoint()
    const distance = Vec.Dist(this.startPoint, current)
    const id = this.shapeId

    this.clearDraftState()
    if (distance < 4 / this.editor.getZoomLevel()) {
      this.editor.deleteShapes([id])
    } else {
      this.editor.select(id)
    }
    this.editor.setCurrentTool('select')
  }

  onCancel() {
    this.discardDraft()
    this.editor.setCurrentTool('select')
  }

  onInterrupt() {
    this.discardDraft()
  }

  onExit() {
    this.discardDraft()
  }

  clearDraftState() {
    this.shapeId = null
    this.startPoint = null
    this.endIndex = null
  }

  discardDraft() {
    if (this.shapeId) this.editor.deleteShapes([this.shapeId])
    this.clearDraftState()
  }
}
