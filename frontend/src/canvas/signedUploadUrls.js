// Direct-resolved Supabase signed URLs for `/uploads/<name>` references,
// populated from the board-load response. Lets images load straight from the
// Supabase CDN instead of bouncing every request through the slow Render
// backend. Module-scoped so the static assetStore can read it.
const signedUploadUrls = new Map()

export function setSignedUploadUrls(map) {
  if (!map) return
  for (const [name, url] of Object.entries(map)) {
    if (url) signedUploadUrls.set(name, url)
  }
}

export function getSignedUploadUrl(filename) {
  return signedUploadUrls.get(filename)
}
