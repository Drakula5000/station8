const API = import.meta.env?.VITE_API_URL || ''

export function classifyDroppedFile(file) {
  const name = String(file?.name || '').toLowerCase()
  if (name.endsWith('.pdf')) return { type: 'pdf' }
  if (name.endsWith('.docx')) return { type: 'office', kind: 'gdoc', label: 'Google Doc' }
  if (name.endsWith('.pptx')) return { type: 'office', kind: 'gslide', label: 'Google Slides' }
  return { type: 'unsupported' }
}

export async function importOfficeFile(file, folderId) {
  const form = new FormData()
  form.append('file', file)
  if (folderId) form.append('folder_id', folderId)
  const response = await fetch(`${API}/api/google/import-office`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.item || !data?.kind) {
    const error = new Error(data?.error || 'Office import failed.')
    error.code = data?.error || 'office_import_failed'
    throw error
  }
  return data
}
