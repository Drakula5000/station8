import { useRef, useState } from 'react'
import { PDF_MAX_BYTES, validatePdfFiles } from '../pdf'
import { pdfProgressLabel, uploadPdfFiles } from '../pdfUpload'

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PdfUploadPanel({
  folderOptions,
  initialFolderId,
  onCancel,
  onComplete = onCancel,
  onBusyChange = () => {},
  onUploaded,
}) {
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const closeAfterAbortRef = useRef(false)
  const [files, setFiles] = useState([])
  const [folderId, setFolderId] = useState(initialFolderId)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [errors, setErrors] = useState([])

  const addFiles = (nextFiles) => {
    const { accepted, rejected } = validatePdfFiles(nextFiles)
    setErrors(rejected.map(item => item.reason))
    if (!accepted.length) return
    setFiles(current => {
      const seen = new Set(current.map(file => `${file.name}:${file.size}:${file.lastModified}`))
      return [...current, ...accepted.filter(file => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))]
    })
  }

  const removeFile = (index) => {
    if (busy) return
    setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const submit = async () => {
    if (!files.length || busy) return
    setBusy(true)
    onBusyChange(true)
    setErrors([])
    const controller = new AbortController()
    abortRef.current = controller
    closeAfterAbortRef.current = false
    let result
    try {
      result = await uploadPdfFiles(
        files,
        folderId === '__root__' ? null : folderId,
        setProgress,
        { signal: controller.signal },
      )
    } catch (error) {
      abortRef.current = null
      if (error?.name === 'AbortError' && closeAfterAbortRef.current) {
        if (error.uploaded?.length) onUploaded(error.uploaded)
        setBusy(false)
        onBusyChange(false)
        setProgress(null)
        onCancel()
        return
      }
      setErrors([error?.message || 'PDF upload failed.'])
      setBusy(false)
      onBusyChange(false)
      setProgress(null)
      return
    }
    abortRef.current = null
    if (result.uploaded.length) onUploaded(result.uploaded)
    if (result.failed.length) {
      setErrors(result.failed.map(item => `${item.file?.name || 'PDF'}: ${item.error}`))
      setFiles(result.failed.map(item => item.file).filter(Boolean))
      setBusy(false)
      onBusyChange(false)
      setProgress(null)
      return
    }
    setBusy(false)
    onBusyChange(false)
    onComplete()
  }

  const cancel = () => {
    const cancellable = busy && ['opening', 'reading', 'ocr'].includes(progress?.phase)
    if (cancellable) {
      closeAfterAbortRef.current = true
      setProgress(current => ({ ...(current || {}), stopping: true }))
      abortRef.current?.abort()
      return
    }
    if (!busy) onCancel()
  }

  return (
    <>
      <button
        className={`pdf-drop-zone${dragging ? ' is-dragging' : ''}`}
        type="button"
        autoFocus
        onClick={() => !busy && inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!busy) addFiles(event.dataTransfer.files)
        }}
        disabled={busy}
      >
        <span className="pdf-drop-zone-title">Drop PDFs here</span>
        <span className="pdf-drop-zone-copy">or click to choose one or more files · up to {PDF_MAX_BYTES / (1024 * 1024)} MB each</span>
      </button>
      <input
        ref={inputRef}
        className="pdf-file-input"
        type="file"
        accept=".pdf,application/pdf"
        multiple
        onChange={(event) => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />

      {files.length > 0 && (
        <div className="pdf-upload-list">
          {files.map((file, index) => (
            <div className="pdf-upload-row" key={`${file.name}:${file.size}:${file.lastModified}`}>
              <div className="pdf-upload-file">
                <span className="pdf-upload-name">{file.name}</span>
                <span className="pdf-upload-size">{formatBytes(file.size)}</span>
              </div>
              <button type="button" onClick={() => removeFile(index)} disabled={busy} aria-label={`Remove ${file.name}`}>×</button>
            </div>
          ))}
        </div>
      )}

      <label className="modal-field">
        <span className="modal-field-label">Add to</span>
        <select className="folder-select" value={folderId} onChange={event => setFolderId(event.target.value)} disabled={busy}>
          {folderOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      {busy && <div className="pdf-upload-progress" role="status">{pdfProgressLabel(progress)}</div>}
      {errors.length > 0 && (
        <div className="pdf-upload-errors" role="alert">
          {errors.map((error, index) => <div key={`${error}:${index}`}>{error}</div>)}
        </div>
      )}

      <div className="modal-footer">
        <button
          className="btn-ghost"
          onClick={cancel}
          type="button"
          disabled={busy && !['opening', 'reading', 'ocr'].includes(progress?.phase)}
        >
          {busy ? 'Stop' : 'Cancel'}
        </button>
        <button className="btn-primary" onClick={submit} type="button" disabled={!files.length || busy}>
          {busy ? 'Adding…' : `Add ${files.length > 1 ? `${files.length} PDFs` : 'PDF'}`}
        </button>
      </div>
    </>
  )
}
