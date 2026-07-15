import { createWorker, PSM } from 'tesseract.js'

export const OCR_TARGET_WIDTH = 2000
export const OCR_MAX_PIXELS = 6_000_000
export const OCR_MAX_DIMENSION = 4096

const OCR_WORKER_INIT_TIMEOUT_MS = 60_000
const OCR_RECOGNITION_TIMEOUT_MS = 120_000
const OCR_WORKER_IDLE_MS = 60_000

let workerState = null
let workerGeneration = 0
let jobCounter = 0
let queueTail = Promise.resolve()
let idleTimer = null
let activeInitProgress = null
const progressByJob = new Map()

function asError(value, fallback = 'OCR failed.') {
  if (value instanceof Error) return value
  if (typeof value === 'string' && value.trim()) return new Error(value)
  return new Error(fallback)
}

function abortError() {
  const error = new Error('PDF text indexing was stopped.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
}

function waitForRecognition(promise, signal) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, abortError())
    const timeoutId = setTimeout(() => {
      finish(reject, new Error('OCR took too long on this page. Try a clearer or smaller scan.'))
    }, OCR_RECOGNITION_TIMEOUT_MS)
    promise.then(
      value => finish(resolve, value),
      error => finish(reject, error),
    )
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function waitForWorker(promise, signal) {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, abortError())
    promise.then(
      value => finish(resolve, value),
      error => finish(reject, error),
    )
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function reportProgress(listener, message) {
  if (typeof listener !== 'function') return
  try {
    listener(message)
  } catch {
    // Progress is advisory and must never break recognition.
  }
}

function routeWorkerProgress(message) {
  const listener = progressByJob.get(message?.userJobId)
  if (listener) {
    reportProgress(listener, message)
    return
  }
  if (activeInitProgress?.state === workerState) {
    reportProgress(activeInitProgress.listener, message)
  }
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

function enqueueOcrWork(work) {
  const result = queueTail.then(work, work)
  queueTail = result.catch(() => {})
  return result
}

async function terminateState(state, resolvedWorker = null) {
  if (!state) return
  if (workerState === state) workerState = null
  clearIdleTimer()

  if (resolvedWorker) {
    await resolvedWorker.terminate().catch(() => {})
    return
  }

  // Never await the library's raw initialization promise here: Tesseract.js
  // 7 can leave it pending after a language-download failure. If it eventually
  // resolves after a timeout/reset, retire that abandoned worker immediately.
  state.rawPromise?.then(worker => worker.terminate()).catch(() => {})
}

function startWorker(onProgress) {
  clearIdleTimer()
  if (workerState) return workerState

  const state = {
    generation: ++workerGeneration,
    rawPromise: null,
    promise: null,
  }
  workerState = state
  activeInitProgress = { state, listener: onProgress }

  let rejectInitialization
  let initializationSettled = false
  const reportedFailure = new Promise((resolve, reject) => {
    void resolve
    rejectInitialization = reject
  })

  try {
    state.rawPromise = Promise.resolve(createWorker('eng', undefined, {
      logger: routeWorkerProgress,
      errorHandler: (error) => {
        if (!initializationSettled) rejectInitialization(asError(error, 'OCR language data could not be loaded.'))
      },
    }))
  } catch (error) {
    state.rawPromise = Promise.reject(error)
  }

  let timeoutId
  const timeout = new Promise((resolve, reject) => {
    void resolve
    timeoutId = setTimeout(() => {
      reject(new Error('OCR took too long to start. Check your connection and try again.'))
    }, OCR_WORKER_INIT_TIMEOUT_MS)
  })

  state.promise = Promise.race([state.rawPromise, reportedFailure, timeout])
    .then(async (worker) => {
      initializationSettled = true
      if (workerState !== state) {
        await worker.terminate().catch(() => {})
        throw new Error('OCR worker was replaced while it was loading.')
      }
      return worker
    })
    .catch((error) => {
      initializationSettled = true
      if (workerState === state) workerState = null
      state.rawPromise?.then(worker => worker.terminate()).catch(() => {})
      throw asError(error, 'OCR could not start.')
    })
    .finally(() => {
      clearTimeout(timeoutId)
      if (activeInitProgress?.state === state) activeInitProgress = null
    })

  return state
}

function scheduleIdleRelease(state) {
  clearIdleTimer()
  if (!state || workerState !== state) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    enqueueOcrWork(async () => {
      if (workerState !== state) return
      const worker = await state.promise.catch(() => null)
      await terminateState(state, worker)
    })
  }, OCR_WORKER_IDLE_MS)
}

export function getOcrRasterSize(
  sourceWidth,
  sourceHeight,
  {
    targetWidth = OCR_TARGET_WIDTH,
    maxPixels = OCR_MAX_PIXELS,
    maxDimension = OCR_MAX_DIMENSION,
  } = {},
) {
  const width = Number(sourceWidth)
  const height = Number(sourceHeight)
  if (!(width > 0) || !(height > 0)) throw new Error('Image dimensions are unavailable for OCR.')

  const scale = Math.min(
    targetWidth / width,
    Math.sqrt(maxPixels / (width * height)),
    maxDimension / Math.max(width, height),
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

// Shared preprocessing for board images and PDF pages: grayscale removes
// color noise and full-range autocontrast normalizes faded scans. The canvas
// is intentionally modified in place so one page is the only large raster
// retained while a scanned PDF is processed.
export function preprocessOcrCanvas(canvas) {
  const width = canvas?.width || 0
  const height = canvas?.height || 0
  const context = canvas?.getContext?.('2d', { willReadFrequently: true })
  if (!context || !width || !height) throw new Error('Could not prepare an image for OCR.')

  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  let low = 255
  let high = 0
  for (let index = 0; index < data.length; index += 4) {
    const gray = (0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]) | 0
    data[index] = data[index + 1] = data[index + 2] = gray
    if (gray < low) low = gray
    if (gray > high) high = gray
  }
  if (high > low) {
    const range = high - low
    for (let index = 0; index < data.length; index += 4) {
      const value = (((data[index] - low) * 255) / range) | 0
      data[index] = data[index + 1] = data[index + 2] = value
    }
  }
  context.putImageData(imageData, 0, 0)
  return canvas
}

async function preprocessBlob(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('The image could not be decoded for OCR.'))
      element.src = url
    })
    const size = getOcrRasterSize(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('The browser could not create an OCR canvas.')
    context.drawImage(image, 0, 0, size.width, size.height)
    return preprocessOcrCanvas(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function normalizeOcrText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

// Strict OCR path used by PDF indexing. Unlike the historical image-upload
// wrapper below, failures are surfaced so a scanned PDF cannot be saved with
// an empty index merely because the OCR engine failed to initialize.
export function recognizeImageText(input, {
  onProgress = () => {},
  pageSegMode = PSM.AUTO,
  signal,
  preprocess = true,
} = {}) {
  return enqueueOcrWork(async () => {
    throwIfAborted(signal)
    clearIdleTimer()

    const isBlob = typeof Blob !== 'undefined' && input instanceof Blob
    const target = preprocess
      ? (isBlob ? await preprocessBlob(input) : preprocessOcrCanvas(input))
      : input
    throwIfAborted(signal)

    const state = startWorker(onProgress)
    let worker
    try {
      try {
        worker = await waitForWorker(state.promise, signal)
      } catch (error) {
        if (error?.name === 'AbortError') await terminateState(state)
        throw error
      }
      throwIfAborted(signal)
      const jobId = `station8-ocr-${++jobCounter}`
      progressByJob.set(jobId, onProgress)
      try {
        const result = await waitForRecognition(
          worker.recognize(
            target,
            { tessedit_pageseg_mode: String(pageSegMode) },
            { text: true },
            jobId,
          ),
          signal,
        )
        throwIfAborted(signal)
        return normalizeOcrText(result?.data?.text)
      } catch (error) {
        await terminateState(state, worker)
        if (error?.name === 'AbortError') throw error
        throw asError(error, 'OCR recognition failed.')
      } finally {
        progressByJob.delete(jobId)
      }
    } finally {
      if (workerState === state) scheduleIdleRelease(state)
    }
  })
}

// Board-image OCR remains best effort for backwards compatibility: an image
// still uploads if OCR is unavailable. It uses the same queued worker and
// bounded preprocessing as strict PDF OCR, so there is only one OCR pipeline.
export async function ocrImage(input) {
  try {
    return await recognizeImageText(input)
  } catch {
    return ''
  }
}

export function releaseOcrWorker() {
  return enqueueOcrWork(async () => {
    const state = workerState
    if (!state) return
    const worker = await state.promise.catch(() => null)
    await terminateState(state, worker)
  })
}
