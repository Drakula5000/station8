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

export async function ocrImage(input) {
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(input)
    return (data?.text || '').replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}
