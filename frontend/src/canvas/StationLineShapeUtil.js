import { LineShapeUtil } from 'tldraw'

// tldraw Line already provides an unlimited sequence of draggable vertices:
// every segment has a midpoint create handle, and dragging it inserts another
// vertex. Station hides tldraw's style panel, though, so stock lines stay
// polygonal unless the hidden spline setting is changed. Make that interaction
// directly match Station's UX: new lines are smooth, and dragging any midpoint
// on an older straight line automatically turns it into a cubic spline.
export class StationLineShapeUtil extends LineShapeUtil {
  getDefaultProps() {
    return { ...super.getDefaultProps(), spline: 'cubic' }
  }

  onHandleDragStart(shape, info) {
    const next = super.onHandleDragStart(shape, info)
    if (info.handle.type !== 'create') return next
    if (!next) return next
    return {
      ...next,
      props: { ...next.props, spline: 'cubic' },
    }
  }
}
