import { StateNode, Vec, createShapeId } from 'tldraw'
import { STATION_CONNECTOR_TYPE } from './StationConnectorShapeUtil'

export const STATION_CONNECTOR_TOOL = 's8-connector'

export class StationConnectorTool extends StateNode {
  static id = STATION_CONNECTOR_TOOL

  shapeId = null
  startPoint = null

  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  onPointerDown() {
    const point = this.editor.inputs.getCurrentPagePoint()
    const id = createShapeId()

    this.editor.markHistoryStoppingPoint('create connector')
    this.editor.createShape({
      id,
      type: STATION_CONNECTOR_TYPE,
      x: point.x,
      y: point.y,
      props: {
        points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      },
    })

    this.shapeId = id
    this.startPoint = new Vec(point.x, point.y)
    this.editor.select(id)
  }

  onPointerMove() {
    if (!this.shapeId || !this.startPoint) return
    const current = this.editor.inputs.getCurrentPagePoint()
    this.editor.updateShape({
      id: this.shapeId,
      type: STATION_CONNECTOR_TYPE,
      props: {
        points: [
          { x: 0, y: 0 },
          { x: current.x - this.startPoint.x, y: current.y - this.startPoint.y },
        ],
      },
    })
  }

  onPointerUp() {
    if (!this.shapeId || !this.startPoint) return
    const current = this.editor.inputs.getCurrentPagePoint()
    const distance = Vec.Dist(this.startPoint, current)
    const id = this.shapeId

    this.shapeId = null
    this.startPoint = null

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

  discardDraft() {
    if (this.shapeId) this.editor.deleteShapes([this.shapeId])
    this.shapeId = null
    this.startPoint = null
  }
}
