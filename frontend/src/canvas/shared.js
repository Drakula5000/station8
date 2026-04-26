// Helpers shared between TldrawCanvas and its sub-components
// (FindBar, FjToolbar). Kept here so neither imports from the other.

export function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

// Resolve an image shape to a URL suitable for full-resolution viewing.
// Uses tldraw's asset resolver so cropped images still point at the original
// source; falls back to the shape's own src prop if the asset lookup fails.
export async function resolveImageShapeUrl(editor, shape) {
  if (!shape || shape.type !== 'image') return null
  const assetId = shape.props?.assetId
  if (assetId) {
    const asset = editor.getAsset(assetId)
    if (asset) {
      try {
        const url = await editor.resolveAssetUrl(asset.id, { shouldResolveToOriginal: true })
        if (url) return url
      } catch { /* fall through to props.src */ }
      if (asset.props?.src) return asset.props.src
    }
  }
  return shape.props?.src || null
}
