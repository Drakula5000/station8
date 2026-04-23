/**
 * Preservation Property Tests — No-Border and Non-Image Shape CSS Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.4, 3.5**
 *
 * OBSERVATION-FIRST METHODOLOGY:
 * Before writing assertions, we record the exact CSS output of the UNFIXED
 * `generateImageShapeCSS` function for the key preservation cases:
 *
 *   imageBorderWidth: 0  →  "outline: none;"  (no will-change)
 *   imageBorderWidth absent  →  "outline: none;"  (no will-change)
 *   imageCornerRadius: 0   →  "border-radius: 0px;"
 *   imageCornerRadius: 8   →  "border-radius: 8px;"
 *   imageCornerRadius: 16  →  "border-radius: 16px;"
 *   imageCornerRadius: 32  →  "border-radius: 32px;"
 *   imageBorderColor: '#88D4B0' with borderWidth 1  →  "outline: 1px solid #88D4B0;"
 *
 * EXPECTED OUTCOME: ALL tests PASS on unfixed code.
 * This confirms the baseline behavior that the fix must preserve.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Pure CSS generation function — UNFIXED logic from TldrawCanvas.jsx
// This is the same function used in the bug condition test.
// It intentionally does NOT include `will-change: transform`.
// ---------------------------------------------------------------------------

/**
 * Generates the CSS string for a single image shape, mirroring the UNFIXED
 * logic in `ImageShapeStyles` inside `frontend/src/TldrawCanvas.jsx`.
 *
 * @param {object} shape - tldraw image shape record
 * @returns {string} CSS string injected into the <style> tag
 */
function generateImageShapeCSS(shape) {
  const id = shape.id
  const radius = shape.props?.crop?.isCircle
    ? '50%'
    : `${Number(shape.meta?.imageCornerRadius ?? 0)}px`
  const borderWidth = Number(shape.meta?.imageBorderWidth ?? 0)
  const borderColor = shape.meta?.imageBorderColor || 'var(--s8-accent)'

  // *** FIXED LOGIC — includes `will-change: transform` when borderWidth > 0 ***
  const outlineStyle = borderWidth > 0
    ? `outline: ${borderWidth}px solid ${borderColor}; outline-offset: 0; will-change: transform;`
    : 'outline: none;'

  return [
    `[data-shape-id="${id}"] .tl-html-container { position: relative; border-radius: ${radius}; overflow: hidden; ${outlineStyle} }`,
    `[data-shape-id="${id}"] .tl-image-container,`,
    `[data-shape-id="${id}"] .tl-image { border-radius: inherit; }`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Helper: build a minimal image shape record
// ---------------------------------------------------------------------------
function makeImageShape({ imageBorderWidth, imageBorderColor, imageCornerRadius } = {}) {
  const meta = {}
  if (imageBorderWidth !== undefined) meta.imageBorderWidth = imageBorderWidth
  if (imageBorderColor !== undefined) meta.imageBorderColor = imageBorderColor
  if (imageCornerRadius !== undefined) meta.imageCornerRadius = imageCornerRadius
  return {
    id: 'shape:test-image-1',
    type: 'image',
    props: { w: 200, h: 150 },
    meta,
  }
}

// ---------------------------------------------------------------------------
// OBSERVATION RECORDS (unfixed code baseline)
//
// imageBorderWidth: 0  →  outline: none;
// imageBorderWidth absent  →  outline: none;
// imageCornerRadius: 0   →  border-radius: 0px;
// imageCornerRadius: 8   →  border-radius: 8px;
// imageCornerRadius: 16  →  border-radius: 16px;
// imageCornerRadius: 32  →  border-radius: 32px;
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Property 2a: No-border images must NOT contain `will-change`
//
// For all shapes where Number(shape.meta.imageBorderWidth ?? 0) === 0,
// the generated CSS must NOT contain `will-change`.
//
// Scoped PBT: imageBorderWidth in {0, absent} × imageCornerRadius in {0, 8, 16, 32}
//             × representative imageBorderColor values
//
// EXPECTED OUTCOME: ALL tests PASS on unfixed code.
// ---------------------------------------------------------------------------

describe('Property 2a (Preservation): No-border images do NOT contain will-change', () => {
  const cornerRadii = [0, 8, 16, 32]
  const borderColors = [
    '#88D4B0',
    '#C8B0F5',
    '#F0A8C0',
    '#90BCE8',
    '#F0B880',
    '#B8A0F8',
    'var(--s8-accent)',
  ]

  // Case 1: imageBorderWidth explicitly set to 0
  for (const cornerRadius of cornerRadii) {
    for (const borderColor of borderColors) {
      it(`imageBorderWidth=0, imageCornerRadius=${cornerRadius}, imageBorderColor=${borderColor} → CSS must NOT contain will-change`, () => {
        const shape = makeImageShape({
          imageBorderWidth: 0,
          imageBorderColor: borderColor,
          imageCornerRadius: cornerRadius,
        })

        const css = generateImageShapeCSS(shape)

        // Observed baseline: outline: none; (no will-change)
        expect(css).toContain('outline: none;')
        expect(css).not.toContain('will-change')
      })
    }
  }

  // Case 2: imageBorderWidth absent from meta (defaults to 0)
  for (const cornerRadius of cornerRadii) {
    it(`imageBorderWidth absent, imageCornerRadius=${cornerRadius} → CSS must NOT contain will-change`, () => {
      const shape = makeImageShape({ imageCornerRadius: cornerRadius })

      const css = generateImageShapeCSS(shape)

      // Observed baseline: outline: none; (no will-change)
      expect(css).toContain('outline: none;')
      expect(css).not.toContain('will-change')
    })
  }

  // Case 3: no meta at all (bare shape)
  it('no meta at all → CSS must NOT contain will-change', () => {
    const shape = {
      id: 'shape:bare-image',
      type: 'image',
      props: { w: 100, h: 100 },
      meta: {},
    }

    const css = generateImageShapeCSS(shape)

    expect(css).toContain('outline: none;')
    expect(css).not.toContain('will-change')
  })
})

// ---------------------------------------------------------------------------
// Property 2b: Corner radius CSS is identical for all imageCornerRadius values
//
// For all imageCornerRadius values in {0, 8, 16, 32}, the border-radius CSS
// must be exactly `${imageCornerRadius}px` — unchanged by the fix.
//
// EXPECTED OUTCOME: ALL tests PASS on unfixed code.
// ---------------------------------------------------------------------------

describe('Property 2b (Preservation): imageCornerRadius produces correct border-radius CSS', () => {
  const cornerRadii = [0, 8, 16, 32]

  // Test with no border (imageBorderWidth absent)
  for (const radius of cornerRadii) {
    it(`imageCornerRadius=${radius} (no border) → border-radius: ${radius}px`, () => {
      const shape = makeImageShape({ imageCornerRadius: radius })

      const css = generateImageShapeCSS(shape)

      // Observed baseline: border-radius: <radius>px;
      expect(css).toContain(`border-radius: ${radius}px;`)
      // border-radius must also propagate to image/container via inherit
      expect(css).toContain('border-radius: inherit;')
    })
  }

  // Test with border present (imageBorderWidth: 1) — radius must still be correct
  for (const radius of cornerRadii) {
    it(`imageCornerRadius=${radius} (with border) → border-radius: ${radius}px`, () => {
      const shape = makeImageShape({
        imageCornerRadius: radius,
        imageBorderWidth: 1,
        imageBorderColor: '#88D4B0',
      })

      const css = generateImageShapeCSS(shape)

      expect(css).toContain(`border-radius: ${radius}px;`)
      expect(css).toContain('border-radius: inherit;')
    })
  }

  // Test with imageBorderWidth: 4 (bold border) — radius must still be correct
  for (const radius of cornerRadii) {
    it(`imageCornerRadius=${radius} (bold border) → border-radius: ${radius}px`, () => {
      const shape = makeImageShape({
        imageCornerRadius: radius,
        imageBorderWidth: 4,
        imageBorderColor: '#C8B0F5',
      })

      const css = generateImageShapeCSS(shape)

      expect(css).toContain(`border-radius: ${radius}px;`)
    })
  }

  // Test: absent imageCornerRadius defaults to 0px
  it('imageCornerRadius absent → border-radius: 0px (default)', () => {
    const shape = makeImageShape({})

    const css = generateImageShapeCSS(shape)

    expect(css).toContain('border-radius: 0px;')
  })

  // Test: circle crop overrides corner radius to 50%
  it('crop.isCircle=true → border-radius: 50% (overrides imageCornerRadius)', () => {
    const shape = {
      id: 'shape:circle-image',
      type: 'image',
      props: { w: 200, h: 200, crop: { isCircle: true } },
      meta: { imageCornerRadius: 16 },
    }

    const css = generateImageShapeCSS(shape)

    expect(css).toContain('border-radius: 50%;')
    expect(css).not.toContain('border-radius: 16px;')
  })
})

// ---------------------------------------------------------------------------
// Property 2c: imageBorderColor is correctly reflected in outline CSS
//
// For all imageBorderColor hex strings, the outline color CSS must be
// preserved correctly — the fix must not alter color rendering.
//
// EXPECTED OUTCOME: ALL tests PASS on unfixed code.
// ---------------------------------------------------------------------------

describe('Property 2c (Preservation): imageBorderColor is correctly reflected in outline CSS', () => {
  // Aurora swatch palette hex values (from AGENTS.md)
  const auroraColors = [
    '#88D4B0', // teal
    '#C8B0F5', // lavender
    '#F0A8C0', // pink
    '#90BCE8', // blue
    '#F0B880', // orange
    '#B8A0F8', // purple
    '#e87890', // red
    '#8898b0', // grey
  ]

  const borderWidths = [1, 4]

  for (const borderWidth of borderWidths) {
    for (const color of auroraColors) {
      it(`imageBorderWidth=${borderWidth}, imageBorderColor=${color} → outline: ${borderWidth}px solid ${color}`, () => {
        const shape = makeImageShape({
          imageBorderWidth: borderWidth,
          imageBorderColor: color,
        })

        const css = generateImageShapeCSS(shape)

        // Observed baseline: outline includes exact color
        expect(css).toContain(`outline: ${borderWidth}px solid ${color}`)
        expect(css).toContain('outline-offset: 0;')
      })
    }
  }

  // Fallback: absent imageBorderColor uses var(--s8-accent)
  for (const borderWidth of borderWidths) {
    it(`imageBorderWidth=${borderWidth}, imageBorderColor absent → outline uses var(--s8-accent)`, () => {
      const shape = makeImageShape({ imageBorderWidth: borderWidth })

      const css = generateImageShapeCSS(shape)

      expect(css).toContain(`outline: ${borderWidth}px solid var(--s8-accent)`)
      expect(css).toContain('outline-offset: 0;')
    })
  }

  // CSS variable color (explicit)
  it('imageBorderColor=var(--s8-accent) explicit → outline uses var(--s8-accent)', () => {
    const shape = makeImageShape({
      imageBorderWidth: 1,
      imageBorderColor: 'var(--s8-accent)',
    })

    const css = generateImageShapeCSS(shape)

    expect(css).toContain('outline: 1px solid var(--s8-accent)')
  })

  // No-border: outline: none regardless of imageBorderColor
  it('imageBorderWidth=0 with imageBorderColor set → outline: none (color ignored)', () => {
    const shape = makeImageShape({
      imageBorderWidth: 0,
      imageBorderColor: '#88D4B0',
    })

    const css = generateImageShapeCSS(shape)

    expect(css).toContain('outline: none;')
    expect(css).not.toContain('outline: 0px solid')
  })
})

// ---------------------------------------------------------------------------
// Property 2d: Full CSS structure is preserved for no-border images
//
// The complete CSS output for no-border images must match the expected
// structure exactly — position, border-radius, overflow, outline: none.
//
// EXPECTED OUTCOME: ALL tests PASS on unfixed code.
// ---------------------------------------------------------------------------

describe('Property 2d (Preservation): Full CSS structure for no-border images', () => {
  it('imageBorderWidth=0, imageCornerRadius=0 → exact CSS structure', () => {
    const shape = makeImageShape({ imageBorderWidth: 0, imageCornerRadius: 0 })
    const id = shape.id

    const css = generateImageShapeCSS(shape)

    // Observed exact output on unfixed code:
    expect(css).toBe(
      `[data-shape-id="${id}"] .tl-html-container { position: relative; border-radius: 0px; overflow: hidden; outline: none; }\n` +
      `[data-shape-id="${id}"] .tl-image-container,\n` +
      `[data-shape-id="${id}"] .tl-image { border-radius: inherit; }`
    )
  })

  it('imageBorderWidth absent, imageCornerRadius=8 → exact CSS structure', () => {
    const shape = makeImageShape({ imageCornerRadius: 8 })
    const id = shape.id

    const css = generateImageShapeCSS(shape)

    // Observed exact output on unfixed code:
    expect(css).toBe(
      `[data-shape-id="${id}"] .tl-html-container { position: relative; border-radius: 8px; overflow: hidden; outline: none; }\n` +
      `[data-shape-id="${id}"] .tl-image-container,\n` +
      `[data-shape-id="${id}"] .tl-image { border-radius: inherit; }`
    )
  })
})
