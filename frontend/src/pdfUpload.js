import { extractPdfPages, validatePdfFiles } from './pdf.js'

const API = import.meta.env?.VITE_API_URL || ''

function pdfAbortError() {
  const error = new Error('PDF text indexing was stopped.')
  error.name = 'AbortError'
  return error
}

async function readApiError(response, fallback) {
  const body = await response.json().catch(() => null)
  return body?.error || body?.message || fallback
}

export function pdfProgressLabel(progress, { includeQueue = true } = {}) {
  if (!progress) return 'Adding PDFs…'
  if (progress.stopping) return 'Stopping after the current page…'
  const queue = includeQueue && progress.total > 1
    ? `${progress.index + 1} of ${progress.total} · `
    : ''
  if (progress.phase === 'opening') return `${queue}Opening PDF…`
  if (progress.phase === 'reading') {
    return `${queue}Reading page ${progress.page} of ${progress.pages}…`
  }
  if (progress.phase === 'ocr') {
    const hasOcrTotal = Number.isInteger(progress.ocrPages) && progress.ocrPages > 0
    const pagePosition = hasOcrTotal
      ? `scanned page ${(progress.ocrIndex || 0) + 1} of ${progress.ocrPages}`
      : `PDF page ${progress.page} of ${progress.pages}`
    const status = String(progress.ocrStatus || '').toLowerCase()
    if (status.includes('loading') || status.includes('initializing')) {
      return `${queue}Loading OCR for ${pagePosition}…`
    }
    if (status.includes('rendering') || status === 'preparing') {
      return `${queue}Preparing ${pagePosition}…`
    }
    const numericProgress = Number(progress.ocrProgress)
    const percent = Number.isFinite(numericProgress) && numericProgress > 0
      ? ` · ${Math.min(100, Math.max(1, Math.round(numericProgress * 100)))}%`
      : ''
    return `${queue}Making ${pagePosition} searchable${percent}…`
  }
  if (progress.phase === 'preparing') return `${queue}Preparing secure upload…`
  if (progress.phase === 'uploading') return `${queue}Uploading PDF…`
  if (progress.phase === 'saving') return `${queue}Saving to Station 8…`
  if (progress.phase === 'saving-index') return 'Saving searchable page text…'
  return `${queue}Adding PDF…`
}

async function requestUploadTicket(file) {
  const response = await fetch(`${API}/api/pdfs/upload-ticket`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      size_bytes: file.size,
      // Browser/OS combinations sometimes label valid PDFs as
      // application/octet-stream. The extension, header, and PDF.js parse are
      // already validated before this request, so send the canonical type.
      mime_type: 'application/pdf',
    }),
  })
  if (!response.ok) throw new Error(await readApiError(response, 'Could not prepare PDF storage.'))
  return response.json()
}

async function uploadBinary(ticketData, file) {
  const uploadUrl = ticketData.upload_url.startsWith('/')
    ? `${API}${ticketData.upload_url}`
    : ticketData.upload_url
  const form = new FormData()
  // The Supabase bucket enforces application/pdf. Blob.slice changes the
  // multipart part's MIME without copying or altering the validated bytes.
  form.append(
    'file',
    file.slice(0, file.size, 'application/pdf'),
    `${ticketData.ticket}.pdf`,
  )
  const response = await fetch(uploadUrl, {
    method: ticketData.method || 'PUT',
    credentials: ticketData.mode === 'local' ? 'include' : 'omit',
    body: form,
  })
  if (!response.ok) throw new Error(await readApiError(response, 'PDF upload failed.'))
}

async function cleanupPendingUpload(ticket) {
  try {
    await fetch(`${API}/api/pdfs/upload-ticket`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    })
  } catch {
    // Best effort. The ticket expires; server-side cleanup can remove an orphan.
  }
}

export async function uploadPdfFile(file, folderId, onProgress = () => {}, { signal } = {}) {
  const { accepted, rejected } = validatePdfFiles([file])
  if (!accepted.length) throw new Error(rejected[0]?.reason || 'Choose a valid PDF.')

  onProgress({ phase: 'opening', page: 0, pages: null })
  const extracted = await extractPdfPages(file, onProgress, { signal })
  if (signal?.aborted) throw pdfAbortError()
  onProgress({ phase: 'preparing' })
  const ticketData = await requestUploadTicket(file)

  try {
    onProgress({ phase: 'uploading' })
    await uploadBinary(ticketData, file)

    onProgress({ phase: 'saving' })
    const response = await fetch(`${API}/api/pdfs/complete`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket: ticketData.ticket,
        name: file.name.replace(/\.pdf$/i, '').trim() || 'Untitled PDF',
        folder_id: folderId || null,
        page_count: extracted.pageCount,
        pages: extracted.pages,
        text_status: extracted.textStatus,
        text_chars: extracted.textChars,
        text_index_version: extracted.textIndexVersion,
      }),
    })
    if (!response.ok) throw new Error(await readApiError(response, 'Could not save PDF metadata.'))
    return response.json()
  } catch (error) {
    // The upload may have reached storage even if the browser lost the
    // response, so always retire the ticket and remove any partial object.
    await cleanupPendingUpload(ticketData.ticket)
    throw error
  }
}

export async function uploadPdfFiles(files, folderId, onProgress = () => {}, { signal } = {}) {
  const { accepted, rejected } = validatePdfFiles(files)
  const uploaded = []
  const failed = rejected.map(item => ({ file: item.file, error: item.reason }))

  for (let index = 0; index < accepted.length; index += 1) {
    if (signal?.aborted) {
      const error = pdfAbortError()
      error.uploaded = uploaded
      throw error
    }
    const file = accepted[index]
    try {
      const record = await uploadPdfFile(file, folderId, progress => {
        onProgress({ ...progress, file, index, total: accepted.length })
      }, { signal })
      uploaded.push(record)
    } catch (error) {
      if (error?.name === 'AbortError') {
        error.uploaded = uploaded
        throw error
      }
      failed.push({ file, error: error?.message || 'Upload failed.' })
    }
  }

  return { uploaded, failed }
}

export async function reindexPdf(
  pdfId,
  onProgress = () => {},
  { signal, fetchImpl = fetch, extract = extractPdfPages } = {},
) {
  onProgress({ phase: 'opening' })
  const sourceResponse = await fetchImpl(`${API}/api/pdfs/${pdfId}/reindex-source`, {
    credentials: 'include',
    signal,
  })
  if (!sourceResponse.ok) {
    throw new Error(await readApiError(sourceResponse, 'Could not prepare the PDF for text indexing.'))
  }
  const source = await sourceResponse.json()
  const sourceUrl = source.url?.startsWith('/') ? `${API}${source.url}` : source.url
  if (!sourceUrl) throw new Error('The PDF source is unavailable for text indexing.')
  const fileResponse = await fetchImpl(sourceUrl, {
    // Supabase signed URLs authorize themselves and deliberately return
    // ACAO:*. Sending the Station 8 session credentials across that redirect
    // would make the browser reject the response under CORS.
    credentials: source.mode === 'local' ? 'include' : 'omit',
    signal,
  })
  if (!fileResponse.ok) {
    throw new Error(await readApiError(fileResponse, 'Could not open the PDF for text indexing.'))
  }
  const file = await fileResponse.blob()
  if (!file.size) throw new Error('The stored PDF is empty.')
  const extracted = await extract(file, onProgress, { signal })
  if (signal?.aborted) throw pdfAbortError()

  onProgress({ phase: 'saving-index' })
  const response = await fetchImpl(`${API}/api/pdfs/${pdfId}/text-index`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page_count: extracted.pageCount,
      pages: extracted.pages,
      text_status: extracted.textStatus,
      text_chars: extracted.textChars,
      text_index_version: extracted.textIndexVersion,
    }),
    signal,
  })
  if (!response.ok) throw new Error(await readApiError(response, 'Could not save the PDF search index.'))
  return response.json()
}
