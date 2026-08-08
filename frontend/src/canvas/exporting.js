import { getSvgAsImage } from 'tldraw'
import { patchSvgExports, hasCustomFill } from './magicFill'

function exportTimestamp() {
  const now = new Date()
  const y = String(now.getFullYear()).slice(2)
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}.${mm}.${ss}`
}

function exportName(editor, ids, format) {
  if (ids.length === 1) {
    const first = editor.getShape(ids[0])
    if (first && editor.isShapeOfType(first, 'frame')) {
      return `${first.props.name || 'frame'}.${format}`
    }
  }
  return `shapes at ${exportTimestamp()}.${format}`
}

function getExportOpts(editor) {
  return {
    background: editor.getInstanceState().exportBackground,
    darkMode: editor.user.getIsDarkMode(),
  }
}

async function getExportBlob(editor, ids, format) {
  const opts = { format, ...getExportOpts(editor) }
  const needsPatch = ids.some(id => hasCustomFill(editor.getShape(id)))
  if (!needsPatch) {
    const { blob } = await editor.toImage(ids, opts)
    return blob
  }
  const { svg, width, height } = await editor.getSvgString(ids, opts)
  const patched = patchSvgExports(svg, editor, ids, opts.darkMode)
  if (format === 'svg') {
    return new Blob([patched], { type: 'image/svg+xml' })
  }
  return await getSvgAsImage(patched, { type: format, width, height, pixelRatio: 2 })
}

export async function downloadExport(editor, ids, format) {
  if (ids.length === 0) return
  const blob = await getExportBlob(editor, ids, format)
  if (!blob) return
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = exportName(editor, ids, format)
  link.click()
  URL.revokeObjectURL(link.href)
}

export async function copyExport(editor, ids, format) {
  if (ids.length === 0) return
  const blob = await getExportBlob(editor, ids, format)
  if (!blob) return
  if (format === 'svg') {
    await navigator.clipboard.writeText(await blob.text())
  } else {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  }
}
