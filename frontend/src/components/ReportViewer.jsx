import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

export default function ReportViewer({ reportId, viewerMode = 'owner' }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(null)

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

  if (error) return (
    <div className="report-embed-wrap">
      <div className="report-embed-error">Could not load report: {error}</div>
    </div>
  )
  if (html === null) return (
    <div className="report-embed-wrap">
      <div className="report-embed-loading">Loading…</div>
    </div>
  )

  return (
    <div className="report-embed-wrap">
      <iframe
        className="report-embed-frame"
        // Reports may contain htmlwidgets (e.g. ggiraph) that require JS, but
        // they do not need same-origin access to the parent app.
        sandbox="allow-scripts"
        srcDoc={html}
        title="Report"
      />
    </div>
  )
}
