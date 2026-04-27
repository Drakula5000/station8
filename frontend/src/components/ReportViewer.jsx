import { useEffect, useRef, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

export default function ReportViewer({ reportId, viewerMode = 'owner' }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(null)
  const iframeRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const url = viewerMode === 'visitor'
      ? `${API}/api/visitor/reports/${reportId}`
      : `${API}/api/reports/${reportId}`

    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`)))
      .then(data => {
        if (cancelled) return
        const body = data.report || data
        setHtml(body.html || '')
      })
      .catch(e => { if (!cancelled) setError(e.message) })

    return () => { cancelled = true }
  }, [reportId, viewerMode])

  if (error) return <div className="report-viewer report-viewer-error">Could not load report: {error}</div>
  if (html === null) return <div className="report-viewer report-viewer-loading">Loading…</div>

  return (
    <iframe
      ref={iframeRef}
      className="report-viewer"
      sandbox="allow-same-origin"
      srcDoc={html}
      title="Report"
      style={{ width: '100%', height: '100%', border: 'none', background: 'white' }}
    />
  )
}
