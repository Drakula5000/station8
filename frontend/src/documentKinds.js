export const ROOT_FOLDER = '__root__'

export const DOC_KIND_CONFIG = {
  board: { api: 'boards', label: 'Board', order: 0 },
  gdoc: { api: 'gdocs', label: 'Doc', order: 1 },
  gsheet: { api: 'gsheets', label: 'Sheet', order: 2 },
  gslide: { api: 'gslides', label: 'Slides', order: 3 },
  report: { api: 'reports', label: 'Report', order: 4 },
  pdf: { api: 'pdfs', label: 'PDF', order: 5 },
}

export const DOC_KINDS = Object.keys(DOC_KIND_CONFIG)
export const DOC_KIND_API = Object.fromEntries(DOC_KINDS.map(kind => [kind, DOC_KIND_CONFIG[kind].api]))
export const DOC_KIND_LABEL = Object.fromEntries(DOC_KINDS.map(kind => [kind, DOC_KIND_CONFIG[kind].label]))
export const DOC_KIND_ORDER = Object.fromEntries(DOC_KINDS.map(kind => [kind, DOC_KIND_CONFIG[kind].order]))

export function docTypeLabel(type) {
  return DOC_KIND_LABEL[type] || 'Item'
}
