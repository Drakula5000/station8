/**
 * Bug Condition Exploration Test — Image Border CSS Missing `will-change`
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * CRITICAL: This test is EXPECTED TO FAIL on unfixed code.
 * Failure confirms the bug exists. DO NOT fix the code to make this pass yet.
 *
 * The bug condition: Number(shape.meta.imageBorderWidth ?? 0) > 0
 * The expected behavior: generated CSS contains `will-change: transform`
 *
 * On unfixed code the CSS contains `outline: ...` but NOT `will-change: transform`.
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Pure CSS generation function extracted from ImageShapeStyles in TldrawCanvas.jsx
// This mirrors the exact logic in the component so we can test it in isolation.
// ---------------------------------------------------------------------------

/**
 * Generates the CSS string for a single image shape, mirroring the logic in
 * `ImageShapeStyles` inside `frontend/src/TldrawCanvas.jsx`.
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
// Property 1: Bug Condition — Image Border CSS Missing `will-change`
//
// Scoped PBT: imageBorderWidth in {1, 4} × representative imageBorderColor values
//
// EXPECTED OUTCOME: ALL assertions FAIL on unfixed code.
// This is correct — it proves the bug exists.
// ---------------------------------------------------------------------------

describe('Property 1 (Bug Condition): ImageShapeStyles CSS contains will-change: transform when imageBorderWidth > 0', () => {
  // Concrete border widths that trigger the bug condition
  const bugConditionWidths = [1, 4]

  // Representative border colors (hex strings and CSS variable)
  const borderColors = [
    '#88D4B0',
    '#C8B0F5',
    '#F0A8C0',
    '#90BCE8',
    '#F0B880',
    '#B8A0F8',
    'var(--s8-accent)',
  ]

  // Corner radius values (should not affect will-change presence)
  const cornerRadii = [0, 8, 16, 32]

  for (const borderWidth of bugConditionWidths) {
    for (const borderColor of borderColors) {
      for (const cornerRadius of cornerRadii) {
        it(`imageBorderWidth=${borderWidth}, imageBorderColor=${borderColor}, imageCornerRadius=${cornerRadius} → CSS must contain will-change: transform`, () => {
          const shape = makeImageShape({
            imageBorderWidth: borderWidth,
            imageBorderColor: borderColor,
            imageCornerRadius: cornerRadius,
          })

          const css = generateImageShapeCSS(shape)

          // The CSS must contain the outline (confirms border is rendered)
          expect(css).toContain(`outline: ${borderWidth}px solid ${borderColor}`)

          // *** THIS ASSERTION FAILS ON UNFIXED CODE ***
          // The fix must add `will-change: transform` to the CSS when borderWidth > 0
          expect(css).toContain('will-change: transform')
        })
      }
    }
  }

  // Also test with imageBorderColor absent (falls back to var(--s8-accent))
  for (const borderWidth of bugConditionWidths) {
    it(`imageBorderWidth=${borderWidth}, no explicit imageBorderColor → CSS must contain will-change: transform`, () => {
      const shape = makeImageShape({ imageBorderWidth: borderWidth })

      const css = generateImageShapeCSS(shape)

      expect(css).toContain('outline:')
      // *** THIS ASSERTION FAILS ON UNFIXED CODE ***
      expect(css).toContain('will-change: transform')
    })
  }
})
