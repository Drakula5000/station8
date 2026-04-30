import { FrameShapeUtil } from 'tldraw'

// tldraw's frame applies a CSS `clip-path: polygon(...)` to every child
// shape's `.tl-shape` container so children visually clip at the frame's
// bounds. The clip-path also affects browser hit-testing, with a side
// effect that breaks rich-text interactions on text shapes parented to a
// frame: hyperlinks become unclickable and text cannot be highlighted /
// selected, even when the rendered text is fully inside the frame's
// polygon. Moving the same shape off the frame restores both behaviours.
//
// `shouldClipChild` is an optional ShapeUtil hook that the editor checks
// at clip-path build time (see Editor.ts ~ "if (util.shouldClipChild?.
// (shape) === false) continue"). Returning `false` for text shapes skips
// the clip entirely, restoring native pointer events for richText links
// and the contenteditable text-selection range.
//
// Visual trade-off: a text shape parented to a frame whose content extends
// past the frame's bounds will now overflow visually instead of being
// cropped at the frame edge. In practice text shapes inside frames are
// short labels that fit, and the previous "clipped but unreadable + un-
// linkable" state was strictly worse than overflowing-but-functional.
//
// Other shape types (images, geo, draw, note) still clip — they typically
// do overflow frames meaningfully, and they don't carry the rich-text
// hit-test problem.
export class StationFrameShapeUtil extends FrameShapeUtil {
  shouldClipChild(child) {
    if (child.type === 'text') return false
    return true
  }
}
