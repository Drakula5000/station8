import assert from 'node:assert/strict'
import test from 'node:test'

import { pdfProgressLabel, reindexPdf } from './pdfUpload.js'

test('legacy PDF reindex fetches the authenticated binary and saves normalized page text', async () => {
  const calls = []
  const progress = []
  const controller = new AbortController()
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        mode: 'supabase',
        url: 'https://storage.example/signed-scan.pdf',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (calls.length === 2) {
      return new Response(new Blob(['%PDF-1.4\nscan']), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    }
    return new Response(JSON.stringify({
      id: 'legacy-scan',
      text_status: 'indexed',
      text_chars: 17,
      page_count: 2,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const extract = async (file, onProgress, { signal }) => {
    assert.ok(file instanceof Blob)
    assert.equal(signal, controller.signal)
    onProgress({ phase: 'ocr', ocrIndex: 0, ocrPages: 1, ocrProgress: 0.5 })
    return {
      pageCount: 2,
      pages: [{ page: 2, text: 'microwave blender' }],
      textStatus: 'indexed',
      textChars: 17,
      textIndexVersion: 2,
    }
  }

  const result = await reindexPdf(
    'legacy-scan',
    item => progress.push(item),
    { signal: controller.signal, fetchImpl, extract },
  )

  assert.equal(result.text_status, 'indexed')
  assert.equal(calls.length, 3)
  assert.equal(calls[0].url, '/api/pdfs/legacy-scan/reindex-source')
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(calls[1].url, 'https://storage.example/signed-scan.pdf')
  assert.equal(calls[1].options.credentials, 'omit')
  assert.equal(calls[2].url, '/api/pdfs/legacy-scan/text-index')
  assert.equal(calls[2].options.method, 'PUT')
  assert.equal(calls[2].options.credentials, 'include')
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    page_count: 2,
    pages: [{ page: 2, text: 'microwave blender' }],
    text_status: 'indexed',
    text_chars: 17,
    text_index_version: 2,
  })
  assert.deepEqual(progress.map(item => item.phase), ['opening', 'ocr', 'saving-index'])
})

test('PDF OCR progress describes the scanned-page position and recognition percent', () => {
  assert.equal(pdfProgressLabel({
    phase: 'ocr',
    index: 0,
    total: 1,
    ocrIndex: 2,
    ocrPages: 8,
    ocrStatus: 'recognizing text',
    ocrProgress: 0.51,
  }), 'Making scanned page 3 of 8 searchable · 51%…')

  assert.equal(pdfProgressLabel({
    phase: 'ocr',
    index: 0,
    total: 1,
    page: 7,
    pages: 20,
    ocrIndex: 2,
    ocrPages: null,
    ocrStatus: 'recognizing text',
    ocrProgress: 0.51,
  }), 'Making PDF page 7 of 20 searchable · 51%…')
})
