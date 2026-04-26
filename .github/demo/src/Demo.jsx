import { useState, useEffect, useRef, useCallback } from 'react'
import './demo.css'

// ── Real images from Unsplash (free, reliable CDN) ──
const IMG = {
  jellyfish: 'https://images.unsplash.com/photo-1545671913-b89ac1b4ac10?w=400&q=80&fit=crop',
  vent: 'https://images.unsplash.com/photo-1551244072-5d12893278ab?w=400&q=80&fit=crop',
  rov: 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=400&q=80&fit=crop',
}

// ── Board content: stickies, images, text blocks ──
const BOARD_ITEMS = [
  { id: 's1', type: 'sticky', color: '#C8B0F5', title: 'Hypothesis', text: 'Bioluminescence flash patterns in deep-sea cnidarians correlate with proximity to hydrothermal vents.\n\nPrediction: flash frequency increases >2x within 500m of active vents.', rotation: -1.2, col: 0, row: 0 },
  { id: 's2', type: 'sticky', color: '#88D4B0', title: 'Key Finding', text: 'Flash frequency at Site A (vent proximity): 4.2 Hz avg\nSite B (control, 2km from vent): 1.1 Hz avg\n\n→ 3.8x increase confirmed', rotation: 0.8, col: 0, row: 1 },
  { id: 's3', type: 'sticky', color: '#90BCE8', title: 'Methodology', text: '• ROV-mounted photometer array\n• 72hr continuous recording\n• 15 specimens tagged per site\n• Water temp logged every 30s', rotation: 0.5, col: 1, row: 0 },
  { id: 's4', type: 'sticky', color: '#F0B880', title: 'Next Steps', text: '□ Repeat at Pacific site (Mariana)\n□ Test chemical signaling hypothesis\n□ Cross-reference with NOAA thermal data\n□ Draft paper for Marine Biology Letters', rotation: -0.5, col: 1, row: 1 },
  { id: 'img1', type: 'image', src: IMG.jellyfish, alt: 'Atolla wyvillei bioluminescent jellyfish specimen under UV light', ocrText: 'Sample A-2847 Atolla wyvillei depth 2400m', col: 2, row: 0 },
  { id: 'img2', type: 'image', src: IMG.vent, alt: 'Black smoker hydrothermal vent at Juan de Fuca Ridge', ocrText: 'Site A Juan de Fuca vent field 2200m', col: 2, row: 1 },
  { id: 't1', type: 'text', text: 'Sample #A-2847\nSpecies: Atolla wyvillei\nDepth: 2,400m\nTemp: 3.8°C\nCollected: 2026-03-15\nLocation: 34.2°N, 120.8°W', col: 3, row: 0 },
  { id: 't2', type: 'text', text: 'Ref: Haddock et al. (2010)\n"Bioluminescence in the Sea"\nAnnual Review of Marine Science\n\nKey insight: >76% of deep-sea\norganisms produce light.', col: 3, row: 1 },
]

const FRAME2_ITEMS = [
  { id: 'f2s1', type: 'sticky', color: '#e87890', title: 'Site A — Juan de Fuca', text: 'Active hydrothermal vent field\nDepth: 2,200–2,600m\nWater temp at vents: 280–380°C\n\n15 Atolla specimens tagged\n8 Periphylla specimens tagged', rotation: -0.6 },
  { id: 'f2s2', type: 'sticky', color: '#B8A0F8', title: 'Site B — Control', text: '2km from nearest known vent\nDepth: 2,400m\nWater temp: 1.8°C uniform\n\n15 Atolla specimens tagged\nBaseline bioluminescence data', rotation: 0.7 },
  { id: 'f2img', type: 'image', src: IMG.rov, alt: 'ROV Jason II deploying photometer array at Site A', ocrText: '' },
]

// ── Search database: keyword + semantic results ──
// Mirrors real backend: kind values match server.py output
const SEARCH_DB = {
  bioluminescence: [
    { kind: 'text', kindLabel: 'TEXT', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Bioluminescence flash patterns in deep-sea cnidarians correlate with proximity to hydrothermal vents.', matchId: 's1' },
    { kind: 'text', kindLabel: 'TEXT', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Flash frequency at Site A: 4.2 Hz avg — 3.8x increase confirmed', matchId: 's2' },
    { kind: 'ocr', kindLabel: 'OCR', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Sample A-2847 Atolla wyvillei depth 2400m', matchId: 'img1', source: 'OCR from image' },
    { kind: 'text', kindLabel: 'TEXT', board: 'Fieldwork Sites', boardId: 'board-fieldwork', snippet: 'Baseline bioluminescence data — 15 Atolla specimens tagged at Site B', matchId: 'f2s2' },
    { kind: 'gdoc', kindLabel: 'GDOC', board: 'Draft: Bioluminescence & Vent Proximity', boardId: 'gdoc-paper', snippet: 'We report a 3.8x increase in flash frequency among cnidarians within 500m of active vents.' },
    { kind: 'gsheet', kindLabel: 'SHEET', board: 'Specimen Tracking Log', boardId: 'gsheet-data', snippet: 'Atolla wyvillei — Site A — 4.2 Hz avg flash frequency — tagged 2026-03-12' },
  ],
  hydrothermal: [
    { kind: 'frame', kindLabel: 'FRAME', board: 'Fieldwork Sites', boardId: 'board-fieldwork', snippet: 'Site A — Juan de Fuca Ridge — Active hydrothermal vent field', matchId: 'f2s1' },
    { kind: 'alt', kindLabel: 'ALT', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Black smoker hydrothermal vent at Juan de Fuca Ridge', matchId: 'img2', source: 'image alt text' },
    { kind: 'text', kindLabel: 'TEXT', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Bioluminescence flash patterns correlate with proximity to hydrothermal vents.', matchId: 's1' },
  ],
  atolla: [
    { kind: 'ocr', kindLabel: 'OCR', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Sample A-2847 Atolla wyvillei depth 2400m', matchId: 'img1', source: 'OCR from image' },
    { kind: 'text', kindLabel: 'TEXT', board: 'Fieldwork Sites', boardId: 'board-fieldwork', snippet: '15 Atolla specimens tagged, 8 Periphylla specimens tagged at Site A', matchId: 'f2s1' },
    { kind: 'gsheet', kindLabel: 'SHEET', board: 'Specimen Tracking Log', boardId: 'gsheet-data', snippet: 'Atolla wyvillei — Site A — 4.2 Hz avg flash frequency — tagged 2026-03-12' },
  ],
  'deep sea organisms': [
    { kind: 'text', kindLabel: 'TEXT', board: 'Marine Biology Research', boardId: 'board-marine', snippet: '>76% of deep-sea organisms produce light. Most common in cnidarians and ctenophores.', matchId: 't2' },
    { kind: 'text', kindLabel: 'TEXT', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Bioluminescence flash patterns in deep-sea cnidarians correlate with proximity to hydrothermal vents.', matchId: 's1' },
    { kind: 'alt', kindLabel: 'ALT', board: 'Marine Biology Research', boardId: 'board-marine', snippet: 'Atolla wyvillei bioluminescent jellyfish specimen under UV light', matchId: 'img1', source: 'image alt text' },
  ],
}

const VISITOR_DOCS = [
  { id: 'board-marine', title: 'Marine Biology Research', type: 'board', folder: 'Expedition S8-2026', tags: ['bioluminescence', 'deep-sea'], date: 'Mar 18' },
  { id: 'board-fieldwork', title: 'Fieldwork Sites', type: 'board', folder: 'Expedition S8-2026', tags: ['field-data', 'ROV'], date: 'Mar 16' },
  { id: 'gdoc-paper', title: 'Draft: Bioluminescence & Vent Proximity', type: 'gdoc', folder: 'Publications', tags: ['draft'], date: 'Mar 20' },
  { id: 'gsheet-data', title: 'Specimen Tracking Log', type: 'gsheet', folder: 'Expedition S8-2026', tags: ['data'], date: 'Mar 18' },
  { id: 'board-equipment', title: 'Equipment & Logistics', type: 'board', folder: 'Operations', tags: ['ROV'], date: 'Mar 10' },
]

const FOLDERS = [
  { name: 'Expedition S8-2026', count: 3 },
  { name: 'Publications', count: 1 },
  { name: 'Operations', count: 1 },
]
const TAGS = ['bioluminescence', 'deep-sea', 'field-data', 'ROV', 'draft', 'data']

// ── Helpers ──
function hl(text, query) {
  if (!query) return text
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(re)
  return parts.map((p, i) => re.test(p) ? <mark key={i} className="dm">{p}</mark> : p)
}

// ══════════════════════════════════════════════════
// STEP 0: Visitor Home — "Click the search bar"
// ══════════════════════════════════════════════════
function StepHome({ onSearchClick, onTryClick, onCardClick }) {
  const handleTryClick = (w) => { onTryClick(w); }

  return (
    <div className="ds ds-home">
      <div className="dh-topbar">
        <div className="dh-brand-wrap">
          <span className="dh-brand-dot" />
          <span className="dh-brand">Station 8</span>
          <span className="dh-status">Visitor View</span>
          <span className="dh-status">Demo</span>
        </div>
        <button className="dh-search-bar" onClick={onSearchClick}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span className="dh-search-ph">Search everything...</span>
          <span className="dh-search-kbd">⌘K</span>
        </button>
        <button className="dh-logout">Logout</button>
      </div>
      <div className="dh-hero">
        <h1 className="dh-hero-title">Expedition S8-2026</h1>
        <p className="dh-hero-sub">Deep-sea bioluminescence research — Juan de Fuca Ridge hydrothermal vent system</p>
        <div className="dh-hero-tries">
          <span className="dh-tries-label">Try searching:</span>
          {['bioluminescence', 'hydrothermal', 'Atolla', 'deep sea organisms'].map(w => (
            <button key={w} className="dh-try" onClick={() => handleTryClick(w)}>{w}</button>
          ))}
        </div>
        <p className="dh-hero-note">Search uses keyword matching + TF-IDF semantic similarity — finds related content even without exact words</p>
      </div>
      <div className="dh-explore">
        <div>
          <div className="dh-explore-label">Folders</div>
          <div className="dh-chips">{FOLDERS.map(f => (
            <span key={f.name} className="dh-folder-chip">📁 {f.name} <span className="dh-chip-ct">{f.count}</span></span>
          ))}</div>
        </div>
        <div>
          <div className="dh-explore-label">Tags</div>
          <div className="dh-chips">{TAGS.map(t => (
            <span key={t} className="dh-tag-chip">{t}</span>
          ))}</div>
        </div>
      </div>
      <div className="dh-divider"><span className="dh-divider-label">All Documents</span><span className="dh-divider-line" /></div>
      <div className="dh-cards">
        {VISITOR_DOCS.map(d => (
          <button key={d.id} className="dh-card" onClick={() => onCardClick(d)}>
            <div className="dh-card-top">
              <span className="dh-card-type">{d.type === 'board' ? 'Board' : d.type === 'gdoc' ? 'Google Doc' : 'Google Sheet'}</span>
              <span className="dh-card-date">{d.date}</span>
            </div>
            <div className="dh-card-title">{d.title}</div>
            <div className="dh-card-meta">
              <span className="dh-card-folder">📁 {d.folder}</span>
              {d.tags.map(t => <span key={t} className="dh-card-tag">{t}</span>)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// STEP 1-2: Search — typing animation → results
// ══════════════════════════════════════════════════
function StepSearch({ query, results, typingDone, onResultClick }) {
  return (
    <div className="ds ds-search">
      <div className="ds-search-backdrop" />
      <div className="ds-search-modal">
        <div className="ds-search-input-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span className="ds-search-query">{query}</span>
          {!typingDone && <span className="ds-search-cursor" />}
        </div>
        <div className="ds-search-hint">Searches boards, docs, sheets, image OCR text, and image alt text</div>
        {results.length > 0 && (
          <div className="ds-search-results">
            {results.map((r, i) => (
              <button key={i} className="ds-search-result clickable" onClick={() => onResultClick(r)} style={{ animationDelay: `${i * 0.08}s` }}>
                <span className={`ds-kind kind-${r.kind}`}>{r.kindLabel}</span>
                <div className="ds-result-body">
                  <div className="ds-result-quote">{hl(r.snippet, query)}</div>
                  <div className="ds-result-crumb">
                    {r.source && <span className="ds-result-source">{r.source} · </span>}
                    📄 {r.board}
                  </div>
                </div>
                <span className="ds-result-go">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// STEP 3: Board with FindBar + glow + dim + cross-board nav
// ══════════════════════════════════════════════════

// Two boards for cross-board navigation
const BOARDS_MAP = {
  'board-marine': { title: 'Marine Biology Research', items: BOARD_ITEMS, frame2: null },
  'board-fieldwork': { title: 'Fieldwork Sites', items: [], frame2: FRAME2_ITEMS },
}

function StepBoard({ title, matchId, query, results, onBack }) {
  // Build ordered list of all navigable matches across boards
  const allMatches = results.filter(r => r.matchId)
  const totalResults = results.length
  const [globalIdx, setGlobalIdx] = useState(0)

  useEffect(() => {
    const idx = allMatches.findIndex(r => r.matchId === matchId)
    setGlobalIdx(idx >= 0 ? idx : 0)
  }, [matchId]) // eslint-disable-line

  const currentResult = allMatches[globalIdx]
  const currentMatch = currentResult?.matchId || matchId
  const currentBoardId = currentResult?.boardId || 'board-marine'
  const currentBoardTitle = currentResult?.board || title

  // Figure out which board we're showing
  const isFieldwork = currentBoardId === 'board-fieldwork'
  const showFrame1Items = isFieldwork ? [] : BOARD_ITEMS
  const showFrame2Items = FRAME2_ITEMS

  // Board counter for FindBar
  const boardIds = [...new Set(allMatches.map(r => r.boardId))]
  const currentBoardNum = boardIds.indexOf(currentBoardId) + 1
  const totalBoards = boardIds.length
  const matchesOnThisBoard = allMatches.filter(r => r.boardId === currentBoardId)
  const idxOnBoard = matchesOnThisBoard.findIndex(r => r.matchId === currentMatch)
  const total = allMatches.length

  const shapeCounter = total > 0 ? `${globalIdx + 1} of ${totalResults}` : '0 of 0'
  const boardCounter = totalBoards > 1 ? ` · board ${currentBoardNum}/${totalBoards}` : ''
  const counter = shapeCounter + boardCounter

  const goPrev = () => setGlobalIdx(i => (i - 1 + total) % total)
  const goNext = () => setGlobalIdx(i => (i + 1) % total)

  // Render a board item
  const renderItem = (item, inGrid) => {
    const isMatch = item.id === currentMatch
    const isDimmed = query && !isMatch
    const cls = `db-item ${isDimmed ? 'dimmed' : ''} ${isMatch ? 'glowing' : ''}`
    const gridStyle = inGrid && item.col != null ? { gridColumn: item.col + 1, gridRow: item.row + 1 } : {}

    if (item.type === 'sticky') return (
      <div key={item.id} className={cls} style={gridStyle}>
        <div className="db-sticky" style={{ backgroundColor: item.color, transform: `rotate(${item.rotation}deg)` }}>
          <div className="db-sticky-title">{item.title}</div>
          <div className="db-sticky-text">{item.text}</div>
        </div>
        {isMatch && <div className="db-glow-ring"><span className="db-glow-chip">{counter}</span></div>}
      </div>
    )
    if (item.type === 'image') return (
      <div key={item.id} className={cls} style={gridStyle}>
        <div className="db-image-wrap">
          <img src={item.src} alt={item.alt} className="db-image" loading="lazy" />
          {item.ocrText && <div className="db-image-ocr-badge">OCR indexed</div>}
        </div>
        {isMatch && <div className="db-glow-ring"><span className="db-glow-chip">{counter}</span></div>}
      </div>
    )
    if (item.type === 'text') return (
      <div key={item.id} className={cls} style={gridStyle}>
        <div className="db-text-block">{item.text}</div>
        {isMatch && <div className="db-glow-ring"><span className="db-glow-chip">{counter}</span></div>}
      </div>
    )
    return null
  }

  return (
    <div className="ds ds-board" key={currentBoardId}>
      {/* Visitor pill */}
      <div className="db-pill-wrap">
        <div className="db-pill">
          <button className="db-pill-back" onClick={onBack}>←</button>
          <span className="db-pill-sep" />
          <span className="db-pill-brand">Station 8</span>
          <span className="db-pill-sep" />
          <span className="db-pill-title">{currentBoardTitle}</span>
          <span className="db-pill-ro">Read Only</span>
        </div>
      </div>

      {/* FindBar — top center */}
      {query && (
        <div className="db-findbar">
          <span className="db-findbar-label">Find</span>
          <span className="db-findbar-query">{query}</span>
          <span className="db-findbar-counter">{counter}</span>
          <button className="db-findbar-btn" onClick={goPrev} disabled={total <= 1}>↑</button>
          <button className="db-findbar-btn" onClick={goNext} disabled={total <= 1}>↓</button>
          <button className="db-findbar-btn db-findbar-close" onClick={onBack}>✕</button>
        </div>
      )}

      {/* Canvas */}
      <div className="db-canvas">
        {/* Frame 1: Marine Biology Research — always visible */}
        {!isFieldwork && (
          <div className="db-frame" style={{ left: '4%', top: '14%', width: '54%', height: '78%' }}>
            <div className="db-frame-label">Marine Biology Research</div>
            <div className="db-frame-inner">
              {BOARD_ITEMS.map(item => renderItem(item, true))}
            </div>
          </div>
        )}

        {/* Frame 2: Fieldwork Sites */}
        <div className="db-frame" style={isFieldwork
          ? { left: '8%', top: '14%', width: '84%', height: '78%' }
          : { left: '62%', top: '14%', width: '34%', height: '78%' }
        }>
          <div className="db-frame-label">Fieldwork Sites</div>
          <div className={isFieldwork ? 'db-frame-inner' : 'db-frame-col'}>
            {FRAME2_ITEMS.map(item => renderItem(item, false))}
          </div>
        </div>

        {/* Board transition indicator */}
        {totalBoards > 1 && (
          <div className="db-board-indicator">
            {boardIds.map((bid, i) => (
              <span key={bid} className={`db-board-dot ${bid === currentBoardId ? 'active' : ''}`} />
            ))}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="db-toolbar">
        {['Select', 'Hand', '|', 'Sticky', 'Section', 'Shape', 'Text', 'Arrow', 'Draw'].map((t, i) =>
          t === '|' ? <span key={i} className="db-tool-sep" /> :
          <button key={i} className={`db-tool ${t === 'Select' ? 'active' : ''}`} title={t}>
            <span className="db-tool-label">{t === 'Sticky' ? '■' : t === 'Section' ? '⬜' : t === 'Shape' ? '●' : t === 'Text' ? 'T' : t === 'Arrow' ? '↗' : t === 'Draw' ? '✎' : t === 'Select' ? '▸' : '✋'}</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// STEP 3 (gdoc): Google Doc view — iframe-style mockup
// ══════════════════════════════════════════════════
function StepGDoc({ title, query, onBack }) {
  return (
    <div className="ds ds-gdoc">
      <div className="db-pill-wrap">
        <div className="db-pill">
          <button className="db-pill-back" onClick={onBack}>←</button>
          <span className="db-pill-sep" />
          <span className="db-pill-brand">Station 8</span>
          <span className="db-pill-sep" />
          <span className="db-pill-title">{title}</span>
          <span className="db-pill-ro">Read Only</span>
        </div>
      </div>
      <div className="dg-doc-wrap">
        <div className="dg-doc">
          <h1 className="dg-doc-title">Bioluminescence & Vent Proximity</h1>
          <p className="dg-doc-subtitle">Draft — Marine Biology Letters submission</p>
          <div className="dg-doc-body">
            <p className="dg-doc-heading">Abstract</p>
            <p>We report a 3.8x increase in flash frequency among cnidarians within 500m of active hydrothermal vents at the Juan de Fuca Ridge. Continuous 72-hour photometer recordings from ROV Jason II reveal that {query ? hl('bioluminescence', query) : 'bioluminescence'} flash patterns in deep-sea cnidarians correlate strongly with proximity to active vent sites.</p>
            <p className="dg-doc-heading">Methods</p>
            <p>ROV-mounted photometer arrays recorded flash events at two sites: Site A (active vent field, 2,200–2,600m depth) and Site B (control, abyssal plain 2km from nearest vent). 15 Atolla wyvillei specimens were tagged per site using acoustic tracking tags.</p>
            <p className="dg-doc-heading">Results</p>
            <p>Mean flash frequency at Site A was 4.2 Hz (SD 0.8), compared to 1.1 Hz (SD 0.3) at Site B. This 3.8x increase was statistically significant (p &lt; 0.001). Water temperature at vent proximity ranged 280–380°C, with ambient temperatures of 2–4°C.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// STEP 3 (gsheet): Google Sheet view — spreadsheet mockup
// ══════════════════════════════════════════════════
function StepGSheet({ title, query, onBack }) {
  const rows = [
    ['Specimen ID', 'Species', 'Site', 'Flash Freq (Hz)', 'Depth (m)', 'Date Tagged'],
    ['A-2847', 'Atolla wyvillei', 'Site A', '4.2', '2400', '2026-03-12'],
    ['A-2848', 'Atolla wyvillei', 'Site A', '3.9', '2350', '2026-03-12'],
    ['A-2849', 'Periphylla periphylla', 'Site A', '5.1', '2500', '2026-03-13'],
    ['B-1201', 'Atolla wyvillei', 'Site B', '1.1', '2400', '2026-03-15'],
    ['B-1202', 'Atolla wyvillei', 'Site B', '0.9', '2400', '2026-03-15'],
    ['B-1203', 'Periphylla periphylla', 'Site B', '1.4', '2400', '2026-03-16'],
    ['A-2850', 'Atolla wyvillei', 'Site A', '4.5', '2250', '2026-03-13'],
    ['A-2851', 'Atolla wyvillei', 'Site A', '4.0', '2600', '2026-03-13'],
  ]
  return (
    <div className="ds ds-gsheet">
      <div className="db-pill-wrap">
        <div className="db-pill">
          <button className="db-pill-back" onClick={onBack}>←</button>
          <span className="db-pill-sep" />
          <span className="db-pill-brand">Station 8</span>
          <span className="db-pill-sep" />
          <span className="db-pill-title">{title}</span>
          <span className="db-pill-ro">Read Only</span>
        </div>
      </div>
      <div className="dg-sheet-wrap">
        <table className="dg-sheet">
          <thead>
            <tr>{rows[0].map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{query ? hl(cell, query) : cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// STEP 4: Owner View — sidebar + canvas
// ══════════════════════════════════════════════════
function StepOwner() {
  return (
    <div className="ds ds-owner">
      <div className="do-sidebar">
        <div className="do-sidebar-head"><span className="do-sidebar-brand">Workspace</span></div>
        <div className="do-sidebar-search">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <span>Search</span>
          <span className="do-sidebar-kbd">⌘K</span>
        </div>
        <div className="do-sidebar-actions">
          <button className="do-sidebar-action">+ Board</button>
          <button className="do-sidebar-action">+ Doc</button>
          <button className="do-sidebar-action">+ Sheet</button>
        </div>
        <div className="do-sidebar-section">Workspace</div>
        <div className="do-sidebar-tree">
          <div className="do-tree-folder">▸ Expedition S8-2026</div>
          <div className="do-tree-item active">　　Marine Biology Research</div>
          <div className="do-tree-item">　　Fieldwork Sites</div>
          <div className="do-tree-item">　　Equipment & Logistics</div>
          <div className="do-tree-folder">▸ Publications</div>
          <div className="do-tree-item">　　Draft: Bioluminescence & Vent Proximity</div>
          <div className="do-tree-folder">▸ Operations</div>
        </div>
        <div className="do-sidebar-section">Tags</div>
        <div className="do-sidebar-tags">
          {['bioluminescence', 'deep-sea', 'ROV', 'field-data'].map(t => <span key={t} className="do-sidebar-tag">{t}</span>)}
        </div>
      </div>
      <div className="do-canvas">
        <div className="db-pill-wrap">
          <div className="db-pill">
            <button className="db-pill-back">☰</button>
            <span className="db-pill-sep" />
            <span className="db-pill-title">Marine Biology Research</span>
          </div>
        </div>
        <div className="db-canvas">
          <div className="db-frame" style={{ left: '4%', top: '14%', width: '54%', height: '78%' }}>
            <div className="db-frame-label">Marine Biology Research</div>
            <div className="db-frame-inner">
              {BOARD_ITEMS.slice(0, 4).map(item => (
                <div key={item.id} className="db-item" style={{ gridColumn: item.col + 1, gridRow: item.row + 1 }}>
                  <div className="db-sticky" style={{ backgroundColor: item.color, transform: `rotate(${item.rotation}deg)` }}>
                    <div className="db-sticky-title">{item.title}</div>
                    <div className="db-sticky-text">{item.text}</div>
                  </div>
                </div>
              ))}
              {BOARD_ITEMS.filter(i => i.type === 'image').map(item => (
                <div key={item.id} className="db-item" style={{ gridColumn: item.col + 1, gridRow: item.row + 1 }}>
                  <div className="db-image-wrap">
                    <img src={item.src} alt={item.alt} className="db-image" loading="lazy" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="db-frame" style={{ left: '62%', top: '8%', width: '34%', height: '84%' }}>
            <div className="db-frame-label">Fieldwork Sites</div>
            <div className="db-frame-col">
              {FRAME2_ITEMS.filter(i => i.type === 'sticky').map(item => (
                <div key={item.id} className="db-item">
                  <div className="db-sticky" style={{ backgroundColor: item.color, transform: `rotate(${item.rotation}deg)` }}>
                    <div className="db-sticky-title">{item.title}</div>
                    <div className="db-sticky-text">{item.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="db-toolbar">
          {['Select', 'Hand', '|', 'Sticky', 'Section', 'Shape', 'Text', 'Arrow', 'Draw'].map((t, i) =>
            t === '|' ? <span key={i} className="db-tool-sep" /> :
            <button key={i} className={`db-tool ${t === 'Select' ? 'active' : ''}`} title={t}>
              <span className="db-tool-label">{t === 'Sticky' ? '■' : t === 'Section' ? '⬜' : t === 'Shape' ? '●' : t === 'Text' ? 'T' : t === 'Arrow' ? '↗' : t === 'Draw' ? '✎' : t === 'Select' ? '▸' : '✋'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// MAIN DEMO — guided flow
// ══════════════════════════════════════════════════
export default function Demo() {
  const [step, setStep] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [typingDone, setTypingDone] = useState(false)
  const [boardTitle, setBoardTitle] = useState('')
  const [matchId, setMatchId] = useState(null)
  const [docType, setDocType] = useState('board') // 'board' | 'gdoc' | 'gsheet'
  const typingRef = useRef(null)

  const reset = useCallback(() => {
    clearInterval(typingRef.current)
    setStep(0)
    setSearchQuery('')
    setSearchResults([])
    setTypingDone(false)
    setMatchId(null)
  }, [])

  const doSearch = useCallback((word) => {
    const key = word.toLowerCase()
    clearInterval(typingRef.current)
    setStep(1)
    setSearchQuery('')
    setSearchResults([])
    setTypingDone(false)
    let i = 0
    typingRef.current = setInterval(() => {
      i++
      setSearchQuery(key.slice(0, i))
      if (i >= key.length) {
        clearInterval(typingRef.current)
        setTimeout(() => {
          setSearchResults(SEARCH_DB[key] || SEARCH_DB.bioluminescence)
          setTypingDone(true)
          setStep(2)
        }, 350)
      }
    }, 70)
  }, [])

  const clickResult = useCallback((result) => {
    setBoardTitle(result.board)
    setMatchId(result.matchId || null)
    // gdoc/gsheet kinds navigate to a doc view, everything else to board
    const type = (result.kind === 'gdoc' || result.kind === 'gsheet') ? result.kind : 'board'
    setDocType(type)
    setStep(3)
  }, [])

  const clickCard = useCallback((doc) => {
    setBoardTitle(doc.title)
    setSearchQuery('')
    setMatchId(null)
    setDocType(doc.type)
    setStep(3)
  }, [])

  useEffect(() => () => clearInterval(typingRef.current), [])

  const guides = {
    0: null,
    1: null,
    2: null,
    3: null,
    4: null,
  }

  return (
    <div className="demo-shell">
      <div className="demo-header">
        <div className="demo-tabs">
          <button className={`demo-tab ${step === 0 ? 'active' : ''}`} onClick={reset}>Visitor Home</button>
          <button className={`demo-tab ${step >= 1 && step <= 2 ? 'active' : ''}`} onClick={() => doSearch('bioluminescence')}>Search</button>
          <button className={`demo-tab ${step === 3 ? 'active' : ''}`} onClick={() => { setBoardTitle('Marine Biology Research'); setSearchQuery(''); setMatchId(null); setDocType('board'); setStep(3); }}>Board</button>
          <button className={`demo-tab ${step === 4 ? 'active' : ''}`} onClick={() => setStep(4)}>Owner View</button>
        </div>
        <a className="demo-gh" href="https://github.com/Drakula5000/station8" target="_blank" rel="noopener noreferrer">GitHub →</a>
      </div>

      <div className="demo-viewport">
        {step === 0 && <StepHome onSearchClick={() => doSearch('bioluminescence')} onTryClick={doSearch} onCardClick={clickCard} />}
        {(step === 1 || step === 2) && <StepSearch query={searchQuery} results={searchResults} typingDone={typingDone} onResultClick={clickResult} />}
        {step === 3 && docType === 'board' && <StepBoard title={boardTitle} matchId={matchId} query={searchQuery} results={searchResults} onBack={reset} />}
        {step === 3 && docType === 'gdoc' && <StepGDoc title={boardTitle} query={searchQuery} onBack={reset} />}
        {step === 3 && docType === 'gsheet' && <StepGSheet title={boardTitle} query={searchQuery} onBack={reset} />}
        {step === 4 && <StepOwner />}
      </div>

      <div className="demo-footer">
        <span>Interactive demo with sample data — not connected to any live instance</span>
        <span className="demo-footer-hint">Guided tour · Click through to explore</span>
      </div>
    </div>
  )
}
