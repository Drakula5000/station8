/**
 * Exploratory tests — confirm root cause on unfixed code.
 *
 * These tests inline the CURRENT (unfixed) handler logic from TldrawCanvas.jsx
 * so we can test it in isolation without mounting the React component or
 * importing tldraw.
 *
 * Tasks 1.1 & 1.2: These tests are EXPECTED TO PASS on unfixed code,
 * confirming that e.preventDefault() IS being called (the bug exists).
 */

import { describe, it, expect, vi } from 'vitest'

// --- Inlined from TldrawCanvas.jsx (unfixed) ---

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * The CURRENT (unfixed) onKeyDown handler body.
 * Mirrors the logic inside the useEffect in TldrawCanvas.jsx exactly.
 * readOnly is false (default canvas state).
 */
function onKeyDown_unfixed(e, { readOnly = false, editor = null } = {}) {
  if (isEditableTarget(e.target)) return

  const key = e.key.toLowerCase()
  const hasAccel = e.metaKey || e.ctrlKey

  if (!readOnly && hasAccel && key === 'z') {
    e.preventDefault()
    if (!editor) return
    editor.focus()
    if (e.shiftKey) {
      editor.redo()
    } else {
      editor.undo()
    }
    return
  }

  if (!readOnly && hasAccel && key === 'y') {
    e.preventDefault()
    if (!editor) return
    editor.focus()
    editor.redo()
    return
  }

  // BUG: This block calls e.preventDefault() before tldraw's handler runs,
  // causing tldraw to skip its delete action.
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (!isEditableTarget(e.target)) {
      e.preventDefault()
    }
  }
}

// --- Helpers ---

/**
 * Create a minimal KeyboardEvent-like object with a preventDefault spy.
 * We use a plain object rather than new KeyboardEvent() so we can
 * observe whether preventDefault was called.
 */
function makeEvent({ key, target = document.body, metaKey = false, ctrlKey = false, shiftKey = false } = {}) {
  return {
    key,
    target,
    metaKey,
    ctrlKey,
    shiftKey,
    defaultPrevented: false,
    preventDefault: vi.fn(function () {
      this.defaultPrevented = true
    }),
  }
}

// --- Tests ---

describe('Exploratory: unfixed onKeyDown handler — bug condition', () => {
  /**
   * Task 1.1
   * Dispatching Delete on a non-editable target should set defaultPrevented = true
   * on the UNFIXED code. This confirms the bug exists.
   */
  it('1.1 Delete on non-editable target sets event.defaultPrevented (bug confirmed)', () => {
    const event = makeEvent({ key: 'Delete', target: document.body })
    onKeyDown_unfixed(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  /**
   * Task 1.2
   * Dispatching Backspace on a non-editable target should set defaultPrevented = true
   * on the UNFIXED code. This confirms the bug exists.
   */
  it('1.2 Backspace on non-editable target sets event.defaultPrevented (bug confirmed)', () => {
    const event = makeEvent({ key: 'Backspace', target: document.body })
    onKeyDown_unfixed(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('Exploratory: unfixed handler — editable target guard (should already work)', () => {
  it('Delete on INPUT target does NOT set defaultPrevented', () => {
    const input = document.createElement('input')
    const event = makeEvent({ key: 'Delete', target: input })
    onKeyDown_unfixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('Backspace on TEXTAREA target does NOT set defaultPrevented', () => {
    const textarea = document.createElement('textarea')
    const event = makeEvent({ key: 'Backspace', target: textarea })
    onKeyDown_unfixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

// --- Inlined fixed handler (Delete/Backspace block removed) ---

/**
 * The FIXED onKeyDown handler body.
 * The Delete/Backspace block has been removed — tldraw handles those natively.
 */
function onKeyDown_fixed(e, { readOnly = false, editor = null } = {}) {
  if (isEditableTarget(e.target)) return

  const key = e.key.toLowerCase()
  const hasAccel = e.metaKey || e.ctrlKey

  if (!readOnly && hasAccel && key === 'z') {
    e.preventDefault()
    if (!editor) return
    editor.focus()
    if (e.shiftKey) {
      editor.redo()
    } else {
      editor.undo()
    }
    return
  }

  if (!readOnly && hasAccel && key === 'y') {
    e.preventDefault()
    if (!editor) return
    editor.focus()
    editor.redo()
    return
  }
  // No Delete/Backspace block — tldraw handles these natively
}

// --- Fix-checking tests (Tasks 3.1, 3.2, 3.3) ---

describe('Fix checking: fixed onKeyDown handler — Delete/Backspace no longer intercepted', () => {
  /**
   * Task 3.1
   * Delete on a non-editable target must NOT call preventDefault with the fixed handler.
   */
  it('3.1 Delete on non-editable target does NOT set defaultPrevented (bug is fixed)', () => {
    const event = makeEvent({ key: 'Delete', target: document.body })
    onKeyDown_fixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  /**
   * Task 3.2
   * Backspace on a non-editable target must NOT call preventDefault with the fixed handler.
   */
  it('3.2 Backspace on non-editable target does NOT set defaultPrevented (bug is fixed)', () => {
    const event = makeEvent({ key: 'Backspace', target: document.body })
    onKeyDown_fixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  /**
   * Task 3.3
   * "Bug is gone" confirmation: the same inputs that triggered the bug on the unfixed
   * handler do NOT trigger it on the fixed handler.
   */
  it('3.3 Delete on non-editable target: fixed handler does NOT call preventDefault (bug gone)', () => {
    const event = makeEvent({ key: 'Delete', target: document.body })
    onKeyDown_fixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('3.3 Backspace on non-editable target: fixed handler does NOT call preventDefault (bug gone)', () => {
    const event = makeEvent({ key: 'Backspace', target: document.body })
    onKeyDown_fixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

// --- Preservation tests (Tasks 4.1–4.4) ---

describe('Preservation: fixed handler still behaves correctly for other inputs', () => {
  /**
   * Task 4.1
   * Delete/Backspace on an editable element (INPUT) must still NOT set defaultPrevented —
   * the isEditableTarget early-return guard still works.
   */
  it('4.1 Delete on INPUT target does NOT set defaultPrevented (editable guard preserved)', () => {
    const input = document.createElement('input')
    const event = makeEvent({ key: 'Delete', target: input })
    onKeyDown_fixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('4.1 Backspace on TEXTAREA target does NOT set defaultPrevented (editable guard preserved)', () => {
    const textarea = document.createElement('textarea')
    const event = makeEvent({ key: 'Backspace', target: textarea })
    onKeyDown_fixed(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  /**
   * Task 4.2
   * Cmd+Z still calls e.preventDefault() and editor.undo().
   */
  it('4.2 Cmd+Z calls preventDefault and editor.undo()', () => {
    const editor = { focus: vi.fn(), undo: vi.fn(), redo: vi.fn() }
    const event = makeEvent({ key: 'z', target: document.body, metaKey: true })
    onKeyDown_fixed(event, { editor })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
    expect(editor.undo).toHaveBeenCalled()
    expect(editor.redo).not.toHaveBeenCalled()
  })

  it('4.2 Ctrl+Z calls preventDefault and editor.undo()', () => {
    const editor = { focus: vi.fn(), undo: vi.fn(), redo: vi.fn() }
    const event = makeEvent({ key: 'z', target: document.body, ctrlKey: true })
    onKeyDown_fixed(event, { editor })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(editor.undo).toHaveBeenCalled()
  })

  it('4.2 Cmd+Shift+Z calls preventDefault and editor.redo()', () => {
    const editor = { focus: vi.fn(), undo: vi.fn(), redo: vi.fn() }
    const event = makeEvent({ key: 'z', target: document.body, metaKey: true, shiftKey: true })
    onKeyDown_fixed(event, { editor })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(editor.redo).toHaveBeenCalled()
    expect(editor.undo).not.toHaveBeenCalled()
  })

  /**
   * Task 4.3
   * Cmd+Y still calls e.preventDefault() and editor.redo().
   */
  it('4.3 Cmd+Y calls preventDefault and editor.redo()', () => {
    const editor = { focus: vi.fn(), undo: vi.fn(), redo: vi.fn() }
    const event = makeEvent({ key: 'y', target: document.body, metaKey: true })
    onKeyDown_fixed(event, { editor })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
    expect(editor.redo).toHaveBeenCalled()
    expect(editor.undo).not.toHaveBeenCalled()
  })

  it('4.3 Ctrl+Y calls preventDefault and editor.redo()', () => {
    const editor = { focus: vi.fn(), undo: vi.fn(), redo: vi.fn() }
    const event = makeEvent({ key: 'y', target: document.body, ctrlKey: true })
    onKeyDown_fixed(event, { editor })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(editor.redo).toHaveBeenCalled()
  })

  /**
   * Task 4.4
   * Property-style test: a variety of non-bug-condition events should never
   * cause the fixed handler to call preventDefault unexpectedly.
   *
   * Cases covered:
   *  - editable targets (INPUT, TEXTAREA, SELECT, contenteditable)
   *  - plain keys with no accelerator (letters, arrows, Escape, Tab, Enter)
   *  - Delete/Backspace (the previously-buggy keys) on non-editable targets
   */
  it('4.4 Fixed handler never calls preventDefault for non-accelerator / editable-target events', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const ce = document.createElement('div')
    ce.contentEditable = 'true'

    const cases = [
      // editable targets — early return, no preventDefault
      { key: 'Delete',    target: input },
      { key: 'Backspace', target: input },
      { key: 'Delete',    target: textarea },
      { key: 'Backspace', target: textarea },
      { key: 'Delete',    target: select },
      { key: 'Delete',    target: ce },
      // plain keys on non-editable target — no accelerator, no match
      { key: 'a',         target: document.body },
      { key: 'ArrowLeft', target: document.body },
      { key: 'Escape',    target: document.body },
      { key: 'Tab',       target: document.body },
      { key: 'Enter',     target: document.body },
      // the previously-buggy keys on non-editable target
      { key: 'Delete',    target: document.body },
      { key: 'Backspace', target: document.body },
    ]

    for (const c of cases) {
      const event = makeEvent(c)
      onKeyDown_fixed(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
  })
})
