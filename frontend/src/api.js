export const API = import.meta.env?.VITE_API_URL || ''

export const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function readApiError(response, fallback) {
  const body = await response.json().catch(() => null)
  return body?.error || body?.message || fallback
}

export async function fetchJson(url, options = {}, fallback = null) {
  try {
    const res = await fetch(url, { credentials: 'include', ...options })
    if (!res.ok) return fallback
    return await res.json()
  } catch {
    return fallback
  }
}

export function fetchJsonPost(url, payload, fallback = null) {
  return fetchJson(url, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) }, fallback)
}

export function fetchJsonPatch(url, payload, fallback = null) {
  return fetchJson(url, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(payload) }, fallback)
}
