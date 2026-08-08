import { classifyDroppedFile } from './officeImport.js'

export function partitionDroppedFiles(files) {
  const stationFiles = []
  const mediaFiles = []
  const otherFiles = []

  for (const file of Array.from(files || [])) {
    const classification = classifyDroppedFile(file)
    if (classification.type === 'pdf' || classification.type === 'office') {
      stationFiles.push(file)
    } else if (String(file?.type || '').startsWith('image/') || String(file?.type || '').startsWith('video/')) {
      mediaFiles.push(file)
    } else {
      otherFiles.push(file)
    }
  }

  return { stationFiles, mediaFiles, otherFiles }
}
