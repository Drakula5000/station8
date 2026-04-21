import { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter/dist/esm/prism-light'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'

import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'

import html2canvas from 'html2canvas'

SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('html', markup)
SyntaxHighlighter.registerLanguage('markup', markup)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('markdown', markdown)

export const DEFAULT_LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'bash', label: 'Bash' },
  { value: 'sql', label: 'SQL' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Plain text' },
]

function rid() {
  return (
    Math.random().toString(36).slice(2, 12) +
    Math.random().toString(36).slice(2, 12)
  )
}

export default function CodeBlockDialog({
  open,
  onClose,
  onInsert,
  languages = DEFAULT_LANGUAGES,
}) {
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState(languages[0]?.value || 'javascript')
  const textareaRef = useRef(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setLanguage(languages[0]?.value || 'javascript')
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [open, languages])

  if (!open) return null

  const handleInsert = () => {
    if (!code.trim()) return
    onInsert({ code, language })
    onClose()
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal" style={{ width: 560 }}>
        <div className="modal-title">Insert code block</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            style={{
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              background: '#fff',
            }}
          >
            {languages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste or type your code here..."
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 220,
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 13,
              fontFamily:
                "'Space Mono', monospace",
              outline: 'none',
              resize: 'vertical',
              lineHeight: 1.5,
            }}
          />
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleInsert}
            disabled={!code.trim()}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Render code to PNG data URL via off-screen mount ──
async function renderCodeToDataURL({ code, language }) {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.zIndex = '-1'
  host.style.pointerEvents = 'none'
  host.style.background = '#fafafa'
  host.style.padding = '16px'
  host.style.borderRadius = '8px'
  host.style.maxWidth = '900px'
  host.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  document.body.appendChild(host)

  const lang = language === 'text' ? 'text' : language
  const root = createRoot(host)

  await new Promise((resolve) => {
    root.render(
      <SyntaxHighlighter
        language={lang}
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: '16px 18px',
          background: '#fafafa',
          fontSize: 13,
          lineHeight: 1.55,
          borderRadius: 8,
          border: '1px solid #e5e5e5',
        }}
        wrapLongLines={false}
        PreTag="pre"
      >
        {code}
      </SyntaxHighlighter>
    )
    // Two rAFs to let React flush + fonts settle.
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })

  let dataURL = ''
  let width = 0
  let height = 0
  try {
    const canvas = await html2canvas(host, {
      backgroundColor: '#fafafa',
      scale: 2,
      logging: false,
      useCORS: true,
    })
    dataURL = canvas.toDataURL('image/png')
    width = canvas.width / 2
    height = canvas.height / 2
  } finally {
    root.unmount()
    host.remove()
  }

  return { dataURL, width, height }
}

export async function insertCodeBlock({
  excalidrawAPI,
  code,
  language,
  x,
  y,
}) {
  if (!excalidrawAPI) throw new Error('excalidrawAPI is required')
  if (!code || !code.trim()) return null

  const { dataURL, width, height } = await renderCodeToDataURL({
    code,
    language,
  })
  if (!dataURL || !width || !height) return null

  const fileId = rid()
  const now = Date.now()

  excalidrawAPI.addFiles([
    {
      id: fileId,
      mimeType: 'image/png',
      dataURL,
      created: now,
    },
  ])

  const px = typeof x === 'number' ? x : 0
  const py = typeof y === 'number' ? y : 0

  const element = {
    id: rid(),
    type: 'image',
    x: px,
    y: py,
    width,
    height,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 1e6),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1e6),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    status: 'saved',
    fileId,
    scale: [1, 1],
    customData: { codeBlock: { language } },
  }

  const existing = excalidrawAPI.getSceneElementsIncludingDeleted()
  excalidrawAPI.updateScene({ elements: [...existing, element] })

  return element
}
