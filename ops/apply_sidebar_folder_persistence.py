from pathlib import Path

path = Path('frontend/src/App.jsx')
text = path.read_text()


def lines(*items):
    return '\n'.join(items)


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    lines(
        "import { pdfProgressLabel, reindexPdf, uploadPdfFiles } from './pdfUpload'",
        "import './styles/index.css'",
    ),
    lines(
        "import { pdfProgressLabel, reindexPdf, uploadPdfFiles } from './pdfUpload'",
        "import { loadFolderExpansionState, mergeFolderExpansionDefaults, saveFolderExpansionState } from './sidebarFolderState'",
        "import './styles/index.css'",
    ),
    'sidebar folder-state import',
)

replace_once(
    "  const [expandedFolders, setExpandedFolders] = useState({})",
    lines(
        "  const [expandedFolders, setExpandedFolders] = useState(() => loadFolderExpansionState(",
        "    typeof window !== 'undefined' ? window.localStorage : null",
        "  ))",
    ),
    'persistent expandedFolders initializer',
)

replace_once(
    lines(
        "  useEffect(() => {",
        "    foldersRef.current = folders",
        "  }, [folders])",
        "",
        "  useEffect(() => {",
        "    try {",
        "      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))",
    ),
    lines(
        "  useEffect(() => {",
        "    foldersRef.current = folders",
        "  }, [folders])",
        "",
        "  useEffect(() => {",
        "    saveFolderExpansionState(",
        "      typeof window !== 'undefined' ? window.localStorage : null,",
        "      expandedFolders,",
        "    )",
        "  }, [expandedFolders])",
        "",
        "  useEffect(() => {",
        "    try {",
        "      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed))",
    ),
    'folder-state persistence effect',
)

replace_once(
    lines(
        "      setExpandedFolders((current) => {",
        "        const next = { ...current }",
        "        for (const folder of nextFolders) {",
        "          if (!(folder.id in next)) next[folder.id] = true",
        "        }",
        "        return next",
        "      })",
    ),
    "      setExpandedFolders((current) => mergeFolderExpansionDefaults(current, nextFolders))",
    'folder default merge',
)

replace_once(
    lines(
        "      setActiveId(nextActive)",
        "      if (nextActive) {",
        "        const item = (nextDocsByKind[nextActive.type] || []).find(d => d.id === nextActive.id)",
        "        if (item?.folder_id) expandFolderPath(item.folder_id, nextFolders)",
        "      }",
    ),
    "      setActiveId(nextActive)",
    'remove refresh-time forced expansion',
)

replace_once(
    "  }, [auth.authenticated, auth.loading, expandFolderPath, ownerDatabaseMode, ownerMode, ownerPromptDismissed, route.doc, viewerMode])",
    "  }, [auth.authenticated, auth.loading, ownerDatabaseMode, ownerMode, ownerPromptDismissed, route.doc, viewerMode])",
    'refresh dependencies',
)

path.write_text(text)
