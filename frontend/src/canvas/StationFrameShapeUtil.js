import { FrameShapeUtil } from 'tldraw'

// Station 8 presents frames as loose research sections, not crop masks.
// Keep tldraw's useful parent/container behavior, but never hide a child that
// extends beyond the section boundary. This also heals existing boards whose
// pasted text or images were already parented to a frame.
const ColoredFrameShapeUtil = FrameShapeUtil.configure({ showColors: true })

export class StationFrameShapeUtil extends ColoredFrameShapeUtil {
  shouldClipChild() {
    return false
  }
}
