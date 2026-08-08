import { GoogleLogoIcon } from '../icons'

export function GoogleEmbed({ kind, doc, readOnly, googleConnected, onConnectGoogle }) {
  // Embed URLs:
  //   - /edit?usp=…  → full editor UI inside the iframe (owner)
  //   - /preview     → clean read-only render (visitor)
  //
  // Google's /preview view still draws a thin top bar with doc name + "Open in
  // Google" link. We crop that off via CSS (`.is-readonly` on the wrapper) so
  // visitors see only the doc body — Station 8's pill already shows the title.
  //
  // We do NOT try to intercept keyboard shortcuts inside the iframe. Cross-
  // origin iframes own their own keyboard; ⌘F inside a Google Doc goes to
  // Google's in-doc find, and that's fine. Station 8 search is on ⌘K + the
  // visitor-pill search button — both work regardless of focus.
  const url = doc.embed_url
  if (!url) {
    const kindLabel = kind === 'gdoc' ? 'Google Doc' : kind === 'gslide' ? 'Google Slides' : 'Google Sheet'
    return (
      <div className="gdrive-empty">
        <div className="gdrive-empty-card">
          <div className="gdrive-empty-icon"><GoogleLogoIcon /></div>
          <div className="gdrive-empty-title">{kindLabel} not linked yet</div>
          <div className="gdrive-empty-copy">
            {googleConnected
              ? 'This item has no Google file attached yet. Delete and recreate it — new docs and sheets are now created in your Drive automatically.'
              : 'Connect your Google account once and Station 8 will create this file in your Drive automatically.'}
          </div>
          {!googleConnected && (
            <button className="gdrive-empty-cta" onClick={onConnectGoogle} type="button">
              <GoogleLogoIcon /> <span>Connect Google</span>
            </button>
          )}
        </div>
      </div>
    )
  }
  const embedUrl = readOnly ? toPreviewUrl(url) : url
  return (
    <div
      className={`gdrive-embed-wrap${readOnly ? ' is-readonly' : ''}`}
      data-kind={kind}
    >
      <iframe
        className="gdrive-embed-frame"
        src={embedUrl}
        title={doc.name}
        allow="clipboard-write; clipboard-read"
      />
    </div>
  )
}

// Best-effort rewrite of any Drive doc/sheet URL to the clean /preview form.
// Handles /edit, /edit?…, and already-preview URLs. Leaves unknown formats alone.
function toPreviewUrl(url) {
  return url
    .replace(/\/edit(\?.*)?$/, '/preview')
    .replace(/\?embedded=true.*$/, '')
}

export function GDriveUrlField({ value, onChange, googleConnected, placeholder, kindLabel }) {
  return (
    <label className="modal-field gdrive-url-field">
      <span className="modal-field-label">
        {googleConnected ? 'Or import an existing Drive URL' : 'Google Drive URL'}
        {googleConnected ? (
          <span className="gdrive-url-hint">Leave empty to create a brand new {kindLabel} in your Drive automatically.</span>
        ) : (
          <span className="gdrive-url-hint">Paste a Drive URL you've shared as "anyone with link." Required until Google is connected.</span>
        )}
      </span>
      <input
        type="url"
        className="gdrive-url-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}
