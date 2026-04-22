// Canvas-native table builder for Excalidraw boards.
// Produces a rows x cols grid of rectangle cells, each bound to a centered
// text element so users can type directly into cells. All cells share a
// groupId so the table selects as a single unit.

function rid() {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)
}

function rseed() {
  return Math.floor(Math.random() * 1e9)
}

export function buildTable({
  x = 0,
  y = 0,
  rows = 3,
  cols = 3,
  cellW = 140,
  cellH = 40,
  headerRow = true,
} = {}) {
  const now = Date.now()
  const groupId = rid()
  const elements = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isHeader = headerRow && r === 0
      const cellX = x + c * cellW
      const cellY = y + r * cellH

      const rectId = rid()
      const textId = rid()

      const rect = {
        id: rectId,
        type: 'rectangle',
        x: cellX,
        y: cellY,
        width: cellW,
        height: cellH,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: isHeader ? '#f0f0f0' : 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        groupIds: [groupId],
        frameId: null,
        roundness: null,
        seed: rseed(),
        version: 1,
        versionNonce: rseed(),
        isDeleted: false,
        boundElements: [{ id: textId, type: 'text' }],
        updated: now,
        link: null,
        locked: false,
        customData: { isTableCell: true, tableGroupId: groupId, row: r, col: c },
      }

      const fontSize = 16
      const text = {
        id: textId,
        type: 'text',
        x: cellX + cellW / 2,
        y: cellY + cellH / 2 - fontSize / 2,
        width: cellW,
        height: fontSize,
        angle: 0,
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        groupIds: [groupId],
        frameId: null,
        roundness: null,
        seed: rseed(),
        version: 1,
        versionNonce: rseed(),
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
        text: '',
        fontSize,
        fontFamily: 2,
        textAlign: 'center',
        verticalAlign: 'middle',
        baseline: fontSize,
        containerId: rectId,
        originalText: '',
        lineHeight: 1.25,
        autoResize: false,
      }

      elements.push(rect, text)
    }
  }

  return elements
}
