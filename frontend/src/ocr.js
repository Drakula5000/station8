import { createWorker } from 'tesseract.js'

let workerPromise = null

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

// Mirror the server-side preprocessing so client-side OCR quality matches:
// upscale small images so small text is legible, grayscale to strip color noise,
// autocontrast to normalize exposure. Returns a canvas Tesseract can read.
async function preprocess(blobOrFile) {
  const url = URL.createObjectURL(blobOrFile)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = url
    })
    const targetW = 2000
    const scale = img.naturalWidth && img.naturalWidth < targetW
      ? targetW / img.naturalWidth
      : 1
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, w, h)

    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    let lo = 255
    let hi = 0
    for (let i = 0; i < data.length; i += 4) {
      const g = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0
      data[i] = data[i + 1] = data[i + 2] = g
      if (g < lo) lo = g
      if (g > hi) hi = g
    }
    if (hi > lo) {
      const range = hi - lo
      for (let i = 0; i < data.length; i += 4) {
        const v = (((data[i] - lo) * 255) / range) | 0
        data[i] = data[i + 1] = data[i + 2] = v
      }
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function ocrImage(input) {
  try {
    const worker = await getWorker()
    const target = (typeof File !== 'undefined' && input instanceof Blob)
      ? await preprocess(input)
      : input
    const { data } = await worker.recognize(target)
    return (data?.text || '').replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}
