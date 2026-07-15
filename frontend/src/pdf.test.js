import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPdfTextIndex,
  destroyPdfLoadingTask,
  extractPdfDocumentPages,
  mergePdfPageText,
  needsPdfTextReindex,
  normalizePdfPageTextBounded,
  shouldOcrPdfPage,
} from './pdf.js'

function fakePage(text = '', { positioned = false } = {}) {
  const page = {
    cleanupCalls: 0,
    getTextContent: async () => ({
      items: text ? [{
        str: text,
        hasEOL: false,
        ...(positioned ? { transform: [1, 0, 0, 1, 100, 400], width: 300, height: 12 } : {}),
      }] : [],
    }),
    getViewport: () => ({
      width: 600,
      height: 800,
      scale: 1,
      convertToViewportPoint: (x, y) => [x, 800 - y],
    }),
    cleanup() {
      this.cleanupCalls += 1
    },
  }
  return page
}

test('PDF cleanup destroys the loading task rather than the resolved document', async () => {
  let destroyCalls = 0
  const loadingTask = {
    destroy: async () => {
      destroyCalls += 1
    },
  }

  await destroyPdfLoadingTask(loadingTask)

  assert.equal(destroyCalls, 1)
})

test('PDF cleanup does not replace a completed extraction with a teardown error', async () => {
  await assert.doesNotReject(() => destroyPdfLoadingTask({
    destroy: async () => {
      throw new Error('worker already closed')
    },
  }))
})

test('native PDF text skips OCR while blank and page-number layers are OCRed', async () => {
  const nativePage = fakePage('This native paragraph contains enough searchable text to use directly.', { positioned: true })
  const blankPage = fakePage('')
  const pageNumberPage = fakePage('125', { positioned: true })
  const pages = [nativePage, blankPage, pageNumberPage]
  const recognized = []
  const result = await extractPdfDocumentPages({
    numPages: pages.length,
    getPage: async pageNumber => pages[pageNumber - 1],
  }, {
    recognizePage: async (page) => {
      recognized.push(page)
      return page === blankPage ? 'microwave blender' : 'Robot Boy searchable body'
    },
  })

  assert.deepEqual(recognized, [blankPage, pageNumberPage])
  assert.deepEqual(result.pages.map(item => item.page), [1, 2, 3])
  assert.equal(result.pages[1].text, 'microwave blender')
  assert.match(result.pages[2].text, /125/)
  assert.match(result.pages[2].text, /Robot Boy searchable body/)
  assert.equal(result.textStatus, 'indexed')
  assert.equal(nativePage.cleanupCalls, 1)
  assert.equal(blankPage.cleanupCalls, 1)
  assert.equal(pageNumberPage.cleanupCalls, 1)
})

test('OCR failure rejects extraction instead of silently returning no searchable text', async () => {
  const page = fakePage('')
  await assert.rejects(
    extractPdfDocumentPages({ numPages: 1, getPage: async () => page }, {
      recognizePage: async () => { throw new Error('language model unavailable') },
    }),
    /Could not make scanned page 1 searchable.*language model unavailable/,
  )
  assert.equal(page.cleanupCalls, 1)
})

test('native text normalization is cap-aware without joining the full text layer', () => {
  const result = normalizePdfPageTextBounded([
    { str: `  ${'x'.repeat(100_000)}`, hasEOL: true },
    { str: 'text beyond the page limit', hasEOL: false },
  ])

  assert.equal(result.text.length, 100_000)
  assert.equal(result.text, 'x'.repeat(100_000))
  assert.equal(result.truncated, true)

  const exact = normalizePdfPageTextBounded([
    { str: 'x'.repeat(100_000), hasEOL: true },
  ])
  assert.equal(exact.text.length, 100_000)
  assert.equal(exact.truncated, false)

  const unicodeBoundary = normalizePdfPageTextBounded([
    { str: 'a😀b', hasEOL: false },
  ], 2)
  assert.equal(unicodeBoundary.text, 'a')
  assert.equal(unicodeBoundary.truncated, true)

  const repeatedEmojiBoundary = normalizePdfPageTextBounded([
    { str: '😀😀', hasEOL: false },
  ], 3)
  assert.equal(repeatedEmojiBoundary.text, '😀')
  assert.equal(repeatedEmojiBoundary.text.length, 2)
  assert.equal(repeatedEmojiBoundary.truncated, true)

  let consumedItems = 0
  function* cappedItems() {
    consumedItems += 1
    yield { str: 'x'.repeat(100_000), hasEOL: false }
    consumedItems += 1
    yield { str: 'cap overflow', hasEOL: false }
    consumedItems += 1
    throw new Error('normalization read beyond the cap')
  }
  const lazyBoundary = normalizePdfPageTextBounded(cappedItems())
  assert.equal(lazyBoundary.text.length, 100_000)
  assert.equal(lazyBoundary.truncated, true)
  assert.equal(consumedItems, 2)
})

test('OCR output is bounded during extraction before it enters the page index', async () => {
  const page = fakePage('')
  const result = await extractPdfDocumentPages({
    numPages: 1,
    getPage: async () => page,
  }, {
    recognizePage: async () => `OCR_UNIQUE_TERM ${'x'.repeat(100_000)}`,
  })

  assert.equal(result.pages[0].text.length, 100_000)
  assert.match(result.pages[0].text, /^OCR_UNIQUE_TERM/)
  assert.equal(result.textStatus, 'truncated')
  assert.equal(page.cleanupCalls, 1)
})

test('stopping OCR preserves AbortError and still releases the current page', async () => {
  const page = fakePage('')
  const stopped = new Error('stopped by owner')
  stopped.name = 'AbortError'

  await assert.rejects(
    extractPdfDocumentPages({ numPages: 1, getPage: async () => page }, {
      recognizePage: async () => { throw stopped },
    }),
    error => error === stopped,
  )
  assert.equal(page.cleanupCalls, 1)
})

test('sparse-layer detection and merge preserve clean native fragments', () => {
  assert.equal(shouldOcrPdfPage('127'), true)
  assert.equal(shouldOcrPdfPage('A full embedded paragraph with well over thirty two useful characters.'), false)
  assert.equal(mergePdfPageText('127', 'The scanned body'), 'The scanned body\n127')
  assert.equal(mergePdfPageText('Robot Boy', 'Robot Boy was made of tin.'), 'Robot Boy was made of tin.')
})

test('a substantial native text layer confined to the outer margin still triggers OCR', () => {
  const text = 'This header has more than thirty two searchable characters'
  const page = fakePage(text)
  const items = [{
    str: text,
    hasEOL: false,
    // PDF y=780 converts to viewport y=20 on this 800px page, wholly inside
    // the outer 12.5% (100px) top margin despite the substantial text count.
    transform: [1, 0, 0, 1, 100, 780],
    width: 300,
    height: 12,
  }]

  assert.equal(shouldOcrPdfPage(text, items, page), true)
})

test('PDF page and document text caps also apply to OCR output', () => {
  const oversizedPage = buildPdfTextIndex(new Map([[1, 'x'.repeat(100_001)]]), 1)
  assert.equal(oversizedPage.pages[0].text.length, 100_000)
  assert.equal(oversizedPage.textStatus, 'truncated')

  const unicodePage = buildPdfTextIndex(new Map([
    [1, `${'z'.repeat(99_999)}😀`],
  ]), 1)
  assert.equal(unicodePage.pages[0].text.length, 99_999)
  assert.equal(unicodePage.pages[0].text.endsWith('z'), true)
  assert.equal(unicodePage.textStatus, 'truncated')

  const pages = new Map()
  for (let page = 1; page <= 21; page += 1) pages.set(page, 'y'.repeat(100_000))
  const oversizedDocument = buildPdfTextIndex(pages, 21)
  assert.equal(oversizedDocument.textChars, 2_000_000)
  assert.equal(oversizedDocument.pages.length, 20)
  assert.equal(oversizedDocument.textStatus, 'truncated')

  const unicodeDocument = new Map()
  for (let page = 1; page <= 19; page += 1) unicodeDocument.set(page, 'q'.repeat(100_000))
  unicodeDocument.set(20, 'q'.repeat(99_999))
  unicodeDocument.set(21, '😀 important page 21')
  unicodeDocument.set(22, 'Z page 22 must not leapfrog page 21')
  const unicodeBoundary = buildPdfTextIndex(unicodeDocument, 22)
  assert.equal(unicodeBoundary.textChars, 1_999_999)
  assert.equal(unicodeBoundary.pages.length, 20)
  assert.equal(unicodeBoundary.pages.some(page => page.page === 22), false)
  assert.equal(unicodeBoundary.textStatus, 'truncated')
})

test('OCR body text wins the page budget over an untrusted margin-only layer', async () => {
  const marginText = 'x'.repeat(100_000)
  const page = {
    cleanupCalls: 0,
    getTextContent: async () => ({
      items: [{
        str: marginText,
        hasEOL: false,
        transform: [1, 0, 0, 1, 100, 780],
        width: 300,
        height: 12,
      }],
    }),
    getViewport: () => ({
      width: 600,
      height: 800,
      scale: 1,
      convertToViewportPoint: (x, y) => [x, 800 - y],
    }),
    cleanup() { this.cleanupCalls += 1 },
  }

  const result = await extractPdfDocumentPages({
    numPages: 1,
    getPage: async () => page,
  }, {
    recognizePage: async () => 'SCANNED_BODY_UNIQUE_TERM',
  })

  assert.equal(result.textStatus, 'truncated')
  assert.equal(result.pages[0].text.length, 100_000)
  assert.match(result.pages[0].text, /^SCANNED_BODY_UNIQUE_TERM/)
  assert.equal(result.ocrPageCount, 1)
  assert.equal(page.cleanupCalls, 1)
})

test('extraction stops opening pages as soon as the document text budget is full', async () => {
  const nativeText = 'x'.repeat(100_000)
  let getPageCalls = 0
  let cleanupCalls = 0
  let ocrCalls = 0
  const result = await extractPdfDocumentPages({
    numPages: 1000,
    getPage: async () => {
      getPageCalls += 1
      return {
        getTextContent: async () => ({
          items: [{
            str: nativeText,
            hasEOL: false,
            transform: [1, 0, 0, 1, 100, 400],
            width: 300,
            height: 12,
          }],
        }),
        getViewport: () => ({
          width: 600,
          height: 800,
          scale: 1,
          convertToViewportPoint: (x, y) => [x, 800 - y],
        }),
        cleanup: () => { cleanupCalls += 1 },
      }
    },
  }, {
    recognizePage: async () => {
      ocrCalls += 1
      return 'unexpected OCR'
    },
  })

  assert.equal(result.pageCount, 1000)
  assert.equal(result.textChars, 2_000_000)
  assert.equal(result.pages.length, 20)
  assert.equal(result.textStatus, 'truncated')
  assert.equal(result.ocrPageCount, 0)
  assert.equal(getPageCalls, 20)
  assert.equal(cleanupCalls, 20)
  assert.equal(ocrCalls, 0)
})

test('a Unicode boundary cannot make extraction skip ahead to later pages', async () => {
  const fullPage = 'x'.repeat(100_000)
  let getPageCalls = 0
  const result = await extractPdfDocumentPages({
    numPages: 22,
    getPage: async (pageNumber) => {
      getPageCalls += 1
      const text = pageNumber <= 19
        ? fullPage
        : (pageNumber === 20 ? 'x'.repeat(99_999) : '😀 important searchable page text with enough native characters')
      return fakePage(text, { positioned: true })
    },
  }, {
    recognizePage: async () => 'unexpected OCR',
  })

  assert.equal(result.textChars, 1_999_999)
  assert.equal(result.pages.length, 20)
  assert.equal(result.pages.some(page => page.page === 22), false)
  assert.equal(result.textStatus, 'truncated')
  assert.equal(getPageCalls, 21)
})

test('only legacy no-text records need automatic OCR reindexing', () => {
  assert.equal(needsPdfTextReindex({ text_status: 'no_text' }), true)
  assert.equal(needsPdfTextReindex({ text_status: 'no_text', text_index_version: 1 }), true)
  assert.equal(needsPdfTextReindex({ text_status: 'no_text', text_index_version: 2 }), false)
  assert.equal(needsPdfTextReindex({ text_status: 'indexed', text_index_version: 0 }), false)
  assert.equal(needsPdfTextReindex({ text_status: 'no_text', text_index_version: 'invalid' }), true)
})
