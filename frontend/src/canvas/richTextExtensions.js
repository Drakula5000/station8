import { Highlight } from '@tiptap/extension-highlight'
import { Mark, mergeAttributes } from '@tiptap/core'
import { tipTapDefaultExtensions } from 'tldraw'

const INLINE_TEXT_COLOR_MARK = Mark.create({
  name: 'textColor',
  priority: 1101,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          if (!(element instanceof HTMLElement)) return null
          return element.getAttribute('data-text-color') || element.style.color || null
        },
        renderHTML: (attributes) => {
          if (!attributes.color) return {}
          return {
            'data-text-color': attributes.color,
            style: `color: ${attributes.color}`,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'span[data-text-color]' },
      {
        tag: 'span',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement) || !element.style.color) return false
          return { color: element.style.color }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) => commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) => commands.unsetMark(this.name),
    }
  },
})

export const RICH_TEXT_EXTENSIONS = [
  ...tipTapDefaultExtensions.filter((extension) => extension.name !== 'highlight'),
  Highlight.configure({ multicolor: true }),
  INLINE_TEXT_COLOR_MARK,
]
