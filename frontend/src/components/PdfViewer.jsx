const API = import.meta.env.VITE_API_URL || ''

export default function PdfViewer({
  pdfId,
  name,
  viewerMode = 'owner',
  initialPage = null,
  textStatus = 'indexed',
  reindexing = false,
  onReindex = null,
}) {
  const prefix = viewerMode === 'visitor' ? 'visitor/' : ''
  const page = Number.isInteger(initialPage) && initialPage > 0 ? initialPage : null
  const fileUrl = `${API}/api/${prefix}pdfs/${pdfId}/file${page ? `#page=${page}` : ''}`
  const indexLabel = reindexing
    ? 'Indexing scanned pages…'
    : textStatus === 'no_text'
    ? 'No readable text'
    : textStatus === 'truncated'
      ? 'Search index truncated'
      : null

  return (
    <div className="pdf-embed-wrap">
      <iframe
        key={`${pdfId}:${page || 1}`}
        className="pdf-embed-frame"
        src={fileUrl}
        title={name || 'PDF'}
        referrerPolicy="no-referrer"
      />
      <div className="pdf-embed-actions">
        {indexLabel && (
          <span className={`pdf-embed-index-status${reindexing ? ' is-progress' : ''}`}>{indexLabel}</span>
        )}
        {textStatus === 'no_text' && !reindexing && onReindex && (
          <button className="pdf-embed-reindex" type="button" onClick={onReindex}>Retry OCR</button>
        )}
        {page && <span className="pdf-embed-page">Page {page}</span>}
        <a href={fileUrl} target="_blank" rel="noreferrer">Open PDF</a>
      </div>
    </div>
  )
}
