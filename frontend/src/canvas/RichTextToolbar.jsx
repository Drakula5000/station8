import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, preventDefault } from '@tldraw/editor'
import {
  TldrawUiButtonIcon,
  TldrawUiContextualToolbar,
  useEditor,
  useValue,
} from 'tldraw'
import { AURORA_SWATCHES } from '../colors'

const HIGHLIGHT_SWATCHES = [
  { id: 'lavender', color: 'var(--s8-section-violet-bg)' },
  { id: 'pink', color: 'var(--s8-section-rose-bg)' },
  { id: 'blue', color: 'var(--s8-section-blue-bg)' },
  { id: 'teal', color: 'var(--s8-section-teal-bg)' },
  { id: 'orange', color: 'var(--s8-section-amber-bg)' },
  { id: 'grey', color: 'var(--s8-section-slate-bg)' },
]

function rectToBox(rect) {
  return new Box(rect.x, rect.y, rect.width, rect.height)
}

function useIsMousingDownOnTextEditor(textEditor) {
  const [isMousingDown, setIsMousingDown] = useState(false)

  useEffect(() => {
    if (!textEditor?.view?.dom) return undefined

    const handlePointerDown = () => setIsMousingDown(true)
    const handlePointerUp = () => setIsMousingDown(false)
    const downEvents = ['touchstart', 'pointerdown', 'mousedown']
    const upEvents = ['touchend', 'pointerup', 'mouseup']

    downEvents.forEach((eventName) => {
      textEditor.view.dom.addEventListener(eventName, handlePointerDown)
    })
    upEvents.forEach((eventName) => {
      document.body.addEventListener(eventName, handlePointerUp)
    })

    return () => {
      if (textEditor.isInitialized) {
        downEvents.forEach((eventName) => {
          textEditor.view.dom.removeEventListener(eventName, handlePointerDown)
        })
      }
      upEvents.forEach((eventName) => {
        document.body.removeEventListener(eventName, handlePointerUp)
      })
    }
  }, [textEditor])

  return isMousingDown
}

function InlineRichTextToolbar({ textEditor }) {
  const [currentSelection, setCurrentSelection] = useState(null)
  const previousSelectionBounds = useRef(undefined)
  const isMousingDown = useIsMousingDownOnTextEditor(textEditor)

  useEffect(() => {
    const handleSelectionUpdate = ({ editor }) => setCurrentSelection(editor.state.selection)
    const handleForceUpdate = () => setCurrentSelection((selection) => (selection ? { ...selection } : selection))

    textEditor.on('selectionUpdate', handleSelectionUpdate)
    textEditor.on('update', handleForceUpdate)
    handleSelectionUpdate({ editor: textEditor })

    return () => {
      textEditor.off('selectionUpdate', handleSelectionUpdate)
      textEditor.off('update', handleForceUpdate)
    }
  }, [textEditor])

  const getSelectionBounds = useCallback(() => {
    const selection = window.getSelection()
    if (!currentSelection || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return undefined
    }

    const rangeBoxes = []
    for (let i = 0; i < selection.rangeCount; i += 1) {
      rangeBoxes.push(rectToBox(selection.getRangeAt(i).getBoundingClientRect()))
    }

    const bounds = Box.Common(rangeBoxes)
    previousSelectionBounds.current = bounds
    return bounds
  }, [currentSelection])

  const formatButtons = useMemo(() => [
    {
      id: 'bold',
      icon: 'bold',
      title: 'Bold',
      active: () => textEditor.isActive('bold'),
      run: () => textEditor.chain().focus().toggleBold().run(),
    },
    {
      id: 'italic',
      icon: 'italic',
      title: 'Italic',
      active: () => textEditor.isActive('italic'),
      run: () => textEditor.chain().focus().toggleItalic().run(),
    },
    {
      id: 'code',
      icon: 'code',
      title: 'Code',
      active: () => textEditor.isActive('code'),
      run: () => textEditor.chain().focus().toggleCode().run(),
    },
    {
      id: 'bulletList',
      icon: 'bulletList',
      title: 'Bullet list',
      active: () => textEditor.isActive('bulletList'),
      run: () => textEditor.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'link',
      icon: 'link',
      title: 'Set link',
      active: () => textEditor.isActive('link'),
      run: () => {
        const currentHref = textEditor.isActive('link') ? textEditor.getAttributes('link').href || '' : ''
        const nextHref = window.prompt('Link URL', currentHref)
        if (nextHref === null) return
        const href = nextHref.trim()
        if (!href) {
          textEditor.chain().focus().unsetLink().run()
          return
        }
        textEditor.chain().focus().setLink({ href }).run()
      },
    },
  ], [textEditor])

  return (
    <TldrawUiContextualToolbar
      className="s8-rich-text-toolbar"
      getSelectionBounds={getSelectionBounds}
      isMousingDown={isMousingDown}
      changeOnlyWhenYChanges={true}
      label="Text formatting"
    >
      <div className="rich-text-inspector" onPointerDown={preventDefault}>
        <div className="rich-text-inspector__format">
          {formatButtons.map((button) => (
            <button
              key={button.id}
              className={`rich-text-inspector__icon-btn ${button.active() ? 'active' : ''}`}
              onPointerDown={preventDefault}
              onClick={button.run}
              title={button.title}
              type="button"
            >
              <TldrawUiButtonIcon icon={button.icon} small />
            </button>
          ))}
        </div>

        <div className="rich-text-inspector__row">
          <div className="rich-text-inspector__label">Text</div>
          <div className="rich-text-inspector__swatches">
            <button
              className={`rich-text-inspector__clear-btn ${!textEditor.isActive('textColor') ? 'active' : ''}`}
              onPointerDown={preventDefault}
              onClick={() => textEditor.chain().focus().unsetTextColor().run()}
              title="Use the shape's default text color"
              type="button"
            >
              Auto
            </button>
            {AURORA_SWATCHES.map((swatch) => (
              <button
                key={swatch.id}
                className={`rich-text-inspector__swatch rich-text-inspector__swatch--text ${textEditor.isActive('textColor', { color: swatch.bg }) ? 'active' : ''}`}
                onPointerDown={preventDefault}
                onClick={() => {
                  if (textEditor.isActive('textColor', { color: swatch.bg })) {
                    textEditor.chain().focus().unsetTextColor().run()
                    return
                  }
                  textEditor.chain().focus().setTextColor(swatch.bg).run()
                }}
                title={`Text color: ${swatch.id}`}
                type="button"
              >
                <span style={{ color: swatch.bg }}>A</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rich-text-inspector__row">
          <div className="rich-text-inspector__label">Mark</div>
          <div className="rich-text-inspector__swatches">
            <button
              className={`rich-text-inspector__clear-btn ${!textEditor.isActive('highlight') ? 'active' : ''}`}
              onPointerDown={preventDefault}
              onClick={() => textEditor.chain().focus().unsetHighlight().run()}
              title="Remove highlight"
              type="button"
            >
              None
            </button>
            {HIGHLIGHT_SWATCHES.map((swatch) => (
              <button
                key={swatch.id}
                className={`rich-text-inspector__swatch ${textEditor.isActive('highlight', { color: swatch.color }) ? 'active' : ''}`}
                style={{ background: swatch.color }}
                onPointerDown={preventDefault}
                onClick={() => {
                  if (textEditor.isActive('highlight', { color: swatch.color })) {
                    textEditor.chain().focus().unsetHighlight().run()
                    return
                  }
                  textEditor.chain().focus().setHighlight({ color: swatch.color }).run()
                }}
                title={`Highlight: ${swatch.id}`}
                type="button"
              />
            ))}
          </div>
        </div>
      </div>
    </TldrawUiContextualToolbar>
  )
}

export function RichTextToolbar() {
  const editor = useEditor()
  const textEditor = useValue('textEditor', () => editor.getRichTextEditor(), [editor])

  if (editor.getInstanceState().isCoarsePointer || !textEditor) return null

  return <InlineRichTextToolbar textEditor={textEditor} />
}
