export const PDF_MAX_BYTES = 25 * 1024 * 1024
export const PDF_MAX_PAGES = 1000
export const PDF_MAX_TEXT_CHARS = 2_000_000
export const PDF_MAX_PAGE_TEXT_CHARS = 100_000
export const PDF_OCR_NATIVE_ALNUM_THRESHOLD = 32
export const PDF_TEXT_INDEX_VERSION = 2

const PDF_TEXT_MARGIN_RATIO = 0.125

let pdfJsPromise = null
const PDF_WHITESPACE = /\s/u

function slicePdfTextPrefix(text, maxChars, start = 0, sourceEnd = text.length) {
  let end = Math.min(sourceEnd, start + Math.max(0, maxChars))
  if (end > start && end < sourceEnd) {
    const last = text.charCodeAt(end - 1)
    const next = text.charCodeAt(end)
    if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
      end -= 1
    }
  }
  return text.slice(start, end)
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
  }
  return pdfJsPromise
}

export function normalizePdfPageTextBounded(
  items,
  maxChars = PDF_MAX_PAGE_TEXT_CHARS,
) {
  const parts = []
  let buffer = ''
  let length = 0
  let pendingSpace = false
  let started = false
  let truncated = false

  const flush = () => {
    if (!buffer) return
    parts.push(buffer)
    buffer = ''
  }
  const append = (character) => {
    if (length + character.length > maxChars) {
      truncated = true
      return false
    }
    buffer += character
    length += character.length
    if (buffer.length >= 4096) flush()
    return true
  }
  const consume = (value) => {
    for (let index = 0; index < value.length; index += 1) {
      let character = value[index]
      const firstUnit = value.charCodeAt(index)
      const nextUnit = value.charCodeAt(index + 1)
      if (
        firstUnit >= 0xD800 && firstUnit <= 0xDBFF
        && nextUnit >= 0xDC00 && nextUnit <= 0xDFFF
      ) {
        character += value[index + 1]
        index += 1
      }
      if (PDF_WHITESPACE.test(character)) {
        if (started) pendingSpace = true
        continue
      }
      if (pendingSpace) {
        if (!append(' ')) return false
        pendingSpace = false
      }
      if (!append(character)) return false
      started = true
    }
    return true
  }

  for (const item of items || []) {
    if (typeof item?.str === 'string' && item.str && !consume(item.str)) break
    // Match PDF.js's own finder/copy assembly: text runs are contiguous unless
    // the item declares an end-of-line. Adding a space between every run can
    // split one word at a font/style boundary and make exact search miss it.
    if (item?.hasEOL && started) pendingSpace = true
  }
  flush()
  return { text: parts.join(''), truncated }
}

export function normalizePdfPageText(items) {
  return normalizePdfPageTextBounded(items).text
}

function trimPdfTextBounded(value, maxChars = PDF_MAX_PAGE_TEXT_CHARS) {
  const text = String(value || '')
  const limit = Math.max(0, Math.floor(Number(maxChars) || 0))
  let start = 0
  let end = text.length
  while (start < end && PDF_WHITESPACE.test(text[start])) start += 1
  while (end > start && PDF_WHITESPACE.test(text[end - 1])) end -= 1
  const trimmedLength = end - start
  return {
    text: slicePdfTextPrefix(text, limit, start, end),
    truncated: trimmedLength > limit,
  }
}

export function countMeaningfulPdfChars(text) {
  return (String(text || '').match(/[\p{L}\p{N}]/gu) || []).length
}

function hasInteriorPdfText(items, page) {
  const viewport = page?.getViewport?.({ scale: 1 })
  if (!viewport?.convertToViewportPoint || !(viewport.width > 0) || !(viewport.height > 0)) return null
  const left = viewport.width * PDF_TEXT_MARGIN_RATIO
  const right = viewport.width * (1 - PDF_TEXT_MARGIN_RATIO)
  const top = viewport.height * PDF_TEXT_MARGIN_RATIO
  const bottom = viewport.height * (1 - PDF_TEXT_MARGIN_RATIO)
  let foundPositionedText = false

  for (const item of items || []) {
    if (
      typeof item?.str !== 'string'
      || !Array.isArray(item.transform)
      || !Number.isFinite(item.transform[4])
      || !Number.isFinite(item.transform[5])
    ) continue
    let containsText = false
    for (let index = 0; index < item.str.length; index += 1) {
      if (!PDF_WHITESPACE.test(item.str[index])) {
        containsText = true
        break
      }
    }
    if (!containsText) continue
    foundPositionedText = true
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    const width = Math.abs(Number(item.width) || 0) * (Number(viewport.scale) || 1)
    const height = Math.abs(Number(item.height) || 0) * (Number(viewport.scale) || 1)
    const itemLeft = Math.min(x, x + width)
    const itemRight = Math.max(x, x + width)
    const itemTop = Math.min(y, y - height)
    const itemBottom = Math.max(y, y - height)
    if (itemRight >= left && itemLeft <= right && itemBottom >= top && itemTop <= bottom) return true
  }
  // A malformed/custom PDF text source without coordinates still gets the
  // alphanumeric sparse-text check; lack of geometry alone is not evidence
  // that a normal text layer is only a page number or watermark.
  return foundPositionedText ? false : null
}

export function shouldOcrPdfPage(text, items = [], page = null) {
  if (countMeaningfulPdfChars(text) < PDF_OCR_NATIVE_ALNUM_THRESHOLD) return true
  const hasInteriorText = hasInteriorPdfText(items, page)
  return hasInteriorText === false
}

function comparableText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

export function mergePdfPageText(nativeText, ocrText) {
  const nativeValue = trimPdfTextBounded(nativeText).text
  const ocrValue = trimPdfTextBounded(ocrText).text
  if (!nativeValue) return ocrValue
  if (!ocrValue) return nativeValue

  const nativeComparable = comparableText(nativeValue)
  const ocrComparable = comparableText(ocrValue)
  if (ocrComparable.includes(nativeComparable)) return ocrValue
  if (nativeComparable.includes(ocrComparable)) return nativeValue
  // OCR is only requested when the native layer is sparse or confined to a
  // page margin, so the rendered body is the authoritative search source.
  // Keep the clean native fragment too, but put it after OCR so a pathological
  // margin layer cannot consume the entire 100k page budget first.
  return `${ocrValue}\n${nativeValue}`
}

function pageTextFromCollection(pageTexts, pageNumber) {
  if (pageTexts instanceof Map) return pageTexts.get(pageNumber) || ''
  const entry = (pageTexts || []).find(item => item?.page === pageNumber)
  return entry?.text || ''
}

function createPdfTextIndexAccumulator(pageCount, initiallyTruncated = false) {
  return {
    pageCount,
    pages: [],
    textChars: 0,
    truncated: Boolean(initiallyTruncated),
    textBudgetExhausted: false,
  }
}

function appendPdfPageText(accumulator, pageNumber, pageText, pageTruncated = false) {
  const bounded = trimPdfTextBounded(pageText)
  let text = bounded.text
  if (pageTruncated || bounded.truncated) accumulator.truncated = true
  if (!text) return
  const remaining = PDF_MAX_TEXT_CHARS - accumulator.textChars
  if (remaining <= 0) {
    accumulator.truncated = true
    accumulator.textBudgetExhausted = true
    return
  }
  if (text.length > remaining) {
    text = slicePdfTextPrefix(text, remaining)
    accumulator.truncated = true
    accumulator.textBudgetExhausted = true
  }
  if (!text) return
  accumulator.pages.push({ page: pageNumber, text })
  accumulator.textChars += text.length
}

function finishPdfTextIndex(accumulator) {
  return {
    pageCount: accumulator.pageCount,
    pages: accumulator.pages,
    textChars: accumulator.textChars,
    textStatus: accumulator.pages.length
      ? (accumulator.truncated ? 'truncated' : 'indexed')
      : 'no_text',
  }
}

export function buildPdfTextIndex(pageTexts, pageCount, initiallyTruncated = false) {
  const accumulator = createPdfTextIndexAccumulator(pageCount, initiallyTruncated)

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    appendPdfPageText(accumulator, pageNumber, pageTextFromCollection(pageTexts, pageNumber))
    if (accumulator.textBudgetExhausted) break
  }
  return finishPdfTextIndex(accumulator)
}

export function needsPdfTextReindex(record) {
  const version = Number(record?.text_index_version ?? 0)
  return record?.text_status === 'no_text'
    && (!Number.isFinite(version) || version < PDF_TEXT_INDEX_VERSION)
}

function pdfAbortError() {
  const error = new Error('PDF text indexing was stopped.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw pdfAbortError()
}

async function recognizePdfPage(page, { signal, onProgress = () => {} } = {}) {
  throwIfAborted(signal)
  const ocr = await import('./ocr.js')
  const baseViewport = page.getViewport({ scale: 1 })
  const raster = ocr.getOcrRasterSize(baseViewport.width, baseViewport.height)
  const viewport = page.getViewport({ scale: raster.scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('The browser could not create a PDF OCR canvas.')

  let renderTask = null
  const cancelRender = () => renderTask?.cancel?.()
  signal?.addEventListener('abort', cancelRender, { once: true })
  try {
    onProgress({ status: 'rendering page', progress: 0 })
    renderTask = page.render({
      canvasContext: context,
      viewport,
      background: '#fff',
    })
    await renderTask.promise
    throwIfAborted(signal)
    return await ocr.recognizeImageText(canvas, {
      signal,
      preprocess: true,
      onProgress,
    })
  } catch (error) {
    if (signal?.aborted) throw pdfAbortError()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelRender)
    canvas.width = 0
    canvas.height = 0
  }
}

export async function extractPdfDocumentPages(pdf, {
  onProgress = () => {},
  signal,
  recognizePage = recognizePdfPage,
} = {}) {
  if (pdf.numPages > PDF_MAX_PAGES) {
    throw new Error(`PDFs are limited to ${PDF_MAX_PAGES.toLocaleString()} pages.`)
  }

  const accumulator = createPdfTextIndexAccumulator(pdf.numPages)
  let ocrPageCount = 0

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    throwIfAborted(signal)
    onProgress({ phase: 'reading', page: pageNumber, pages: pdf.numPages })
    const page = await pdf.getPage(pageNumber)
    try {
      const content = await page.getTextContent()
      const native = normalizePdfPageTextBounded(content.items)
      let text = native.text
      let pageTruncated = native.truncated

      if (shouldOcrPdfPage(text, content.items, page)) {
        const progressBase = {
          phase: 'ocr',
          page: pageNumber,
          pages: pdf.numPages,
          ocrIndex: ocrPageCount,
          ocrPages: null,
        }
        ocrPageCount += 1
        onProgress({ ...progressBase, ocrStatus: 'preparing', ocrProgress: 0 })
        try {
          const rawOcrText = await recognizePage(page, {
            signal,
            onProgress: (message) => {
              const numericProgress = Number(message?.progress)
              onProgress({
                ...progressBase,
                ocrStatus: message?.status || 'recognizing text',
                ocrProgress: Number.isFinite(numericProgress) ? numericProgress : null,
              })
            },
          })
          const ocr = trimPdfTextBounded(rawOcrText)
          pageTruncated ||= ocr.truncated
          text = mergePdfPageText(text, ocr.text)
        } catch (error) {
          if (error?.name === 'AbortError') throw error
          throw new Error(
            `Could not make scanned page ${pageNumber} searchable. ${error?.message || 'Check your connection and try again.'}`,
            { cause: error },
          )
        }
      }
      appendPdfPageText(accumulator, pageNumber, text, pageTruncated)
    } finally {
      page.cleanup()
    }

    // The backend accepts at most two million searchable characters. Stop
    // opening/rendering later pages once that entire budget is consumed,
    // while preserving the PDF's authoritative total page count.
    if (
      (accumulator.textBudgetExhausted || accumulator.textChars >= PDF_MAX_TEXT_CHARS)
      && pageNumber < pdf.numPages
    ) {
      accumulator.truncated = true
      break
    }
  }

  return {
    ...finishPdfTextIndex(accumulator),
    ocrPageCount,
    textIndexVersion: PDF_TEXT_INDEX_VERSION,
  }
}

export async function destroyPdfLoadingTask(loadingTask) {
  // PDF.js 6 owns document/worker teardown on PDFDocumentLoadingTask. The
  // resolved PDFDocumentProxy no longer exposes destroy(), so calling it after
  // successful extraction turns a valid upload into "destroy is not a
  // function" before the backend ever receives an upload ticket.
  await loadingTask.destroy().catch(() => {})
}

export function validatePdfFiles(files) {
  const accepted = []
  const rejected = []

  for (const file of Array.from(files || [])) {
    const filename = file?.name || 'Untitled PDF'
    if (!filename.toLowerCase().endsWith('.pdf')) {
      rejected.push({ file, reason: `${filename} is not a PDF.` })
      continue
    }
    if (!file.size) {
      rejected.push({ file, reason: `${filename} is empty.` })
      continue
    }
    if (file.size > PDF_MAX_BYTES) {
      rejected.push({ file, reason: `${filename} is larger than 25 MB.` })
      continue
    }
    accepted.push(file)
  }

  return { accepted, rejected }
}

export async function extractPdfPages(file, onProgress = () => {}, { signal } = {}) {
  throwIfAborted(signal)
  const pdfjs = await loadPdfJs()
  const bytes = new Uint8Array(await file.arrayBuffer())
  throwIfAborted(signal)
  const header = new TextDecoder('ascii').decode(bytes.slice(0, 1024))
  if (!header.includes('%PDF-')) throw new Error('This file does not contain a valid PDF header.')

  const loadingTask = pdfjs.getDocument({ data: bytes })
  try {
    const pdf = await loadingTask.promise
    return await extractPdfDocumentPages(pdf, { onProgress, signal })
  } catch (error) {
    if (error?.name === 'PasswordException') {
      throw new Error('Password-protected PDFs cannot be added yet.')
    }
    throw error
  } finally {
    await destroyPdfLoadingTask(loadingTask)
  }
}
