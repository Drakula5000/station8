import {
  DefaultContextMenu,
  DefaultContextMenuContent,
  TldrawUiMenuActionItem,
  TldrawUiMenuGroup,
  TldrawUiMenuSubmenu,
  useEditor,
  useValue,
} from 'tldraw'

function CustomShapeArrangeMenu() {
  const editor = useEditor()
  const bracketSelected = useValue(
    'single unlocked custom shape selected',
    () => {
      const shape = editor.getOnlySelectedShape()
      return Boolean(
        editor.isIn('select') &&
        !editor.getIsReadonly() &&
        shape?.type === 'bracket' &&
        !shape.isLocked,
      )
    },
    [editor],
  )

  if (!bracketSelected) return null

  return (
    <TldrawUiMenuGroup id="bracket-arrange">
      <TldrawUiMenuSubmenu id="arrange" label="context-menu.arrange" size="small">
        <TldrawUiMenuActionItem actionId="flip-horizontal" />
        <TldrawUiMenuActionItem actionId="flip-vertical" />
      </TldrawUiMenuSubmenu>
    </TldrawUiMenuGroup>
  )
}

function StationContextMenuContent() {
  return (
    <>
      <CustomShapeArrangeMenu />
      <DefaultContextMenuContent />
    </>
  )
}

export function StationContextMenu() {
  return (
    <DefaultContextMenu>
      <StationContextMenuContent />
    </DefaultContextMenu>
  )
}
