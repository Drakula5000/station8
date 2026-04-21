"""Research Hub backend.

- /api/boards              list/create boards (Excalidraw canvases)
- /api/boards/<id>         get/update a board (scene snapshot)
- /api/sheets              list/create sheets
- /api/sheets/<id>         get/update a sheet (2D cell array)
- /api/upload              upload an image, OCR it, store text
- /uploads/<filename>      serve uploaded image
- /api/search              hybrid keyword + semantic search across everything
"""
import json
import os
import re
import uuid
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
STATIC_BUILD = os.path.join(BASE_DIR, 'static_build')

BOARDS_FILE = os.path.join(DATA_DIR, 'boards.json')
SHEETS_FILE = os.path.join(DATA_DIR, 'sheets.json')
OCR_FILE = os.path.join(DATA_DIR, 'ocr.json')
WORKSPACE_FILE = os.path.join(DATA_DIR, 'workspace.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)


def _load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, 'r') as f:
        return json.load(f)


def _save(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def _board_file(id): return os.path.join(DATA_DIR, f'board-{id}.json')
def _sheet_file(id): return os.path.join(DATA_DIR, f'sheet-{id}.json')


def _normalize_folder_id(folder_id, folders):
    if folder_id in (None, '', 'null'):
        return None
    folder_ids = {f.get('id') for f in folders}
    return folder_id if folder_id in folder_ids else None


def _normalize_workspace(ws):
    ws = dict(ws or {})
    if not ws.get('name'):
        ws['name'] = 'My Research'
    if 'owner' not in ws:
        ws['owner'] = ''
    if 'public_slug' not in ws:
        ws['public_slug'] = uuid.uuid4().hex[:10]
    if 'created_at' not in ws:
        ws['created_at'] = datetime.now().isoformat()

    raw_folders = ws.get('folders')
    folders = raw_folders if isinstance(raw_folders, list) else []
    normalized = []
    folder_ids = set()
    for folder in folders:
        if not isinstance(folder, dict):
            continue
        folder_id = str(folder.get('id') or '').strip() or str(uuid.uuid4())[:8]
        if folder_id in folder_ids:
            folder_id = str(uuid.uuid4())[:8]
        folder_ids.add(folder_id)
        normalized.append({
            'id': folder_id,
            'name': (folder.get('name') or 'Untitled folder').strip() or 'Untitled folder',
            'parent_id': folder.get('parent_id'),
            'created_at': folder.get('created_at') or datetime.now().isoformat(),
        })

    valid_ids = {f['id'] for f in normalized}
    for folder in normalized:
        if folder['parent_id'] not in valid_ids:
            folder['parent_id'] = None
        if folder['parent_id'] == folder['id']:
            folder['parent_id'] = None

    ws['folders'] = normalized
    return ws


def _get_workspace():
    ws = _load(WORKSPACE_FILE, None)
    if not ws:
        ws = _normalize_workspace({
            'name': 'My Research',
            'owner': '',
            'public_slug': uuid.uuid4().hex[:10],
            'created_at': datetime.now().isoformat(),
            'folders': [],
        })
        _save(WORKSPACE_FILE, ws)
    normalized = _normalize_workspace(ws)
    if normalized != ws:
        _save(WORKSPACE_FILE, normalized)
    return normalized


def _normalize_doc(item, folders):
    doc = dict(item or {})
    doc['folder_id'] = _normalize_folder_id(doc.get('folder_id'), folders)
    if 'tags' not in doc or not isinstance(doc.get('tags'), list):
        doc['tags'] = _parse_tags(doc.get('tags'))
    return doc


def _load_boards():
    folders = _get_workspace().get('folders', [])
    boards = [_normalize_doc(board, folders) for board in _load(BOARDS_FILE, [])]
    return boards


def _save_boards(boards):
    folders = _get_workspace().get('folders', [])
    _save(BOARDS_FILE, [_normalize_doc(board, folders) for board in boards])


def _load_sheets():
    folders = _get_workspace().get('folders', [])
    sheets = [_normalize_doc(sheet, folders) for sheet in _load(SHEETS_FILE, [])]
    return sheets


def _save_sheets(sheets):
    folders = _get_workspace().get('folders', [])
    _save(SHEETS_FILE, [_normalize_doc(sheet, folders) for sheet in sheets])


def _folder_with_descendants(folder_id, folders):
    folder_ids = {folder_id}
    changed = True
    while changed:
        changed = False
        for folder in folders:
            if folder.get('parent_id') in folder_ids and folder.get('id') not in folder_ids:
                folder_ids.add(folder['id'])
                changed = True
    return folder_ids


def _move_docs_from_folder(folder_ids, target_parent_id):
    boards = _load_boards()
    updated_boards = False
    for board in boards:
        if board.get('folder_id') in folder_ids:
            board['folder_id'] = target_parent_id
            updated_boards = True
    if updated_boards:
        _save_boards(boards)

    sheets = _load_sheets()
    updated_sheets = False
    for sheet in sheets:
        if sheet.get('folder_id') in folder_ids:
            sheet['folder_id'] = target_parent_id
            updated_sheets = True
    if updated_sheets:
        _save_sheets(sheets)


def _update_descendant_parent_ids(folder_ids, folders, target_parent_id):
    for folder in folders:
        if folder.get('parent_id') in folder_ids:
            folder['parent_id'] = target_parent_id


def _is_descendant(candidate_parent_id, folder_id, folders):
    children_by_parent = {}
    for folder in folders:
        children_by_parent.setdefault(folder.get('parent_id'), []).append(folder.get('id'))
    stack = list(children_by_parent.get(folder_id, []))
    while stack:
        current = stack.pop()
        if current == candidate_parent_id:
            return True
        stack.extend(children_by_parent.get(current, []))
    return False


def _parse_tags(raw):
    if isinstance(raw, list):
        return [str(t).strip().lstrip('#') for t in raw if str(t).strip()]
    if isinstance(raw, str):
        return [t.strip().lstrip('#') for t in raw.split(',') if t.strip()]
    return []


def _sanitize_parent_id(parent_id, folders, folder_id=None):
    parent_id = _normalize_folder_id(parent_id, folders)
    if folder_id and parent_id == folder_id:
        return None
    if folder_id and parent_id and _is_descendant(parent_id, folder_id, folders):
        return None
    return parent_id


@app.route('/api/folders', methods=['POST'])
def create_folder():
    ws = _get_workspace()
    folders = list(ws.get('folders', []))
    data = request.json or {}
    folder = {
        'id': str(uuid.uuid4())[:8],
        'name': (data.get('name') or 'Untitled folder').strip() or 'Untitled folder',
        'parent_id': _sanitize_parent_id(data.get('parent_id'), folders),
        'created_at': datetime.now().isoformat(),
    }
    folders.append(folder)
    ws['folders'] = folders
    _save(WORKSPACE_FILE, ws)
    return jsonify(folder), 201


@app.route('/api/folders/<folder_id>', methods=['PATCH'])
def patch_folder(folder_id):
    ws = _get_workspace()
    folders = list(ws.get('folders', []))
    data = request.json or {}
    for folder in folders:
        if folder['id'] != folder_id:
            continue
        if 'name' in data:
            folder['name'] = (data['name'] or '').strip() or folder.get('name', 'Untitled folder')
        if 'parent_id' in data:
            folder['parent_id'] = _sanitize_parent_id(data.get('parent_id'), folders, folder_id=folder_id)
        ws['folders'] = folders
        _save(WORKSPACE_FILE, ws)
        return jsonify(folder)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/folders/<folder_id>', methods=['DELETE'])
def delete_folder(folder_id):
    ws = _get_workspace()
    folders = list(ws.get('folders', []))
    target = next((folder for folder in folders if folder['id'] == folder_id), None)
    if not target:
        return jsonify({'error': 'Not found'}), 404

    folder_ids = _folder_with_descendants(folder_id, folders)
    target_parent_id = target.get('parent_id')
    remaining = [folder for folder in folders if folder['id'] not in folder_ids]
    _move_docs_from_folder(folder_ids, target_parent_id)
    _update_descendant_parent_ids(folder_ids, remaining, target_parent_id)
    ws['folders'] = remaining
    _save(WORKSPACE_FILE, ws)
    return '', 204


@app.route('/api/workspace', methods=['GET'])
def get_workspace():
    return jsonify(_get_workspace())


@app.route('/api/workspace', methods=['PATCH'])
def patch_workspace():
    ws = _get_workspace()
    data = request.json or {}
    if 'name' in data: ws['name'] = (data['name'] or '').strip() or ws['name']
    if 'owner' in data: ws['owner'] = (data['owner'] or '').strip()
    _save(WORKSPACE_FILE, ws)
    return jsonify(ws)


@app.route('/api/share/<slug>', methods=['GET'])
def share_by_slug(slug):
    ws = _get_workspace()
    if slug != ws.get('public_slug'):
        return jsonify({'error': 'Invalid slug'}), 404
    return jsonify({
        'workspace': {
            'name': ws.get('name'),
            'owner': ws.get('owner'),
            'folders': ws.get('folders', []),
        },
        'boards': _load_boards(),
        'sheets': _load_sheets(),
    })


@app.route('/api/share/<slug>/board/<board_id>', methods=['GET'])
def share_board(slug, board_id):
    ws = _get_workspace()
    if slug != ws.get('public_slug'):
        return jsonify({'error': 'Invalid slug'}), 404
    return jsonify(_load(_board_file(board_id), {'snapshot': None}))


@app.route('/api/share/<slug>/sheet/<sheet_id>', methods=['GET'])
def share_sheet(slug, sheet_id):
    ws = _get_workspace()
    if slug != ws.get('public_slug'):
        return jsonify({'error': 'Invalid slug'}), 404
    return jsonify(_load(_sheet_file(sheet_id), {'data': []}))


@app.route('/api/share/<slug>/search', methods=['POST'])
def share_search(slug):
    ws = _get_workspace()
    if slug != ws.get('public_slug'):
        return jsonify({'error': 'Invalid slug'}), 404
    return search()


# ── Boards ───────────────────────────────────────────────────────────────────

@app.route('/api/boards', methods=['GET'])
def list_boards():
    boards = _load_boards()
    boards.sort(key=lambda b: b.get('created_at', ''), reverse=True)
    return jsonify(boards)


@app.route('/api/boards', methods=['POST'])
def create_board():
    data = request.json or {}
    name = (data.get('name') or 'Untitled').strip() or 'Untitled'
    folders = _get_workspace().get('folders', [])
    board = {
        'id': str(uuid.uuid4())[:8],
        'name': name,
        'tags': _parse_tags(data.get('tags')),
        'folder_id': _normalize_folder_id(data.get('folder_id'), folders),
        'created_at': datetime.now().isoformat(),
    }
    boards = _load_boards()
    boards.append(board)
    _save_boards(boards)
    _save(_board_file(board['id']), {'snapshot': None})
    return jsonify(board), 201


@app.route('/api/boards/<board_id>', methods=['PATCH'])
def patch_board(board_id):
    data = request.json or {}
    boards = _load_boards()
    folders = _get_workspace().get('folders', [])
    for b in boards:
        if b['id'] == board_id:
            if 'name' in data:
                b['name'] = (data['name'] or '').strip() or b.get('name', 'Untitled')
            if 'tags' in data:
                b['tags'] = _parse_tags(data['tags'])
            if 'folder_id' in data:
                b['folder_id'] = _normalize_folder_id(data.get('folder_id'), folders)
            _save_boards(boards)
            return jsonify(b)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/boards/<board_id>', methods=['DELETE'])
def delete_board(board_id):
    boards = [b for b in _load_boards() if b['id'] != board_id]
    _save_boards(boards)
    fp = _board_file(board_id)
    if os.path.exists(fp):
        os.remove(fp)
    return '', 204


@app.route('/api/boards/<board_id>', methods=['GET'])
def get_board(board_id):
    return jsonify(_load(_board_file(board_id), {'snapshot': None}))


@app.route('/api/boards/<board_id>', methods=['PUT'])
def update_board(board_id):
    data = request.json or {}
    _save(_board_file(board_id), {'snapshot': data.get('snapshot')})
    return '', 204


# ── Sheets ───────────────────────────────────────────────────────────────────

@app.route('/api/sheets', methods=['GET'])
def list_sheets():
    sheets = _load_sheets()
    sheets.sort(key=lambda s: s.get('created_at', ''), reverse=True)
    return jsonify(sheets)


@app.route('/api/sheets', methods=['POST'])
def create_sheet():
    data = request.json or {}
    name = (data.get('name') or 'Untitled').strip() or 'Untitled'
    folders = _get_workspace().get('folders', [])
    sheet = {
        'id': str(uuid.uuid4())[:8],
        'name': name,
        'tags': _parse_tags(data.get('tags')),
        'folder_id': _normalize_folder_id(data.get('folder_id'), folders),
        'created_at': datetime.now().isoformat(),
    }
    sheets = _load_sheets()
    sheets.append(sheet)
    _save_sheets(sheets)
    _save(_sheet_file(sheet['id']), {'data': []})
    return jsonify(sheet), 201


@app.route('/api/sheets/<sheet_id>', methods=['PATCH'])
def patch_sheet(sheet_id):
    data = request.json or {}
    sheets = _load_sheets()
    folders = _get_workspace().get('folders', [])
    for s in sheets:
        if s['id'] == sheet_id:
            if 'name' in data:
                s['name'] = (data['name'] or '').strip() or s.get('name', 'Untitled')
            if 'tags' in data:
                s['tags'] = _parse_tags(data['tags'])
            if 'folder_id' in data:
                s['folder_id'] = _normalize_folder_id(data.get('folder_id'), folders)
            _save_sheets(sheets)
            return jsonify(s)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/sheets/<sheet_id>', methods=['DELETE'])
def delete_sheet(sheet_id):
    sheets = [s for s in _load_sheets() if s['id'] != sheet_id]
    _save_sheets(sheets)
    fp = _sheet_file(sheet_id)
    if os.path.exists(fp):
        os.remove(fp)
    return '', 204


@app.route('/api/sheets/<sheet_id>', methods=['GET'])
def get_sheet(sheet_id):
    return jsonify(_load(_sheet_file(sheet_id), {'data': []}))


@app.route('/api/sheets/<sheet_id>', methods=['PUT'])
def update_sheet(sheet_id):
    data = request.json or {}
    _save(_sheet_file(sheet_id), {'data': data.get('data') or []})
    return '', 204


# ── Uploads + OCR ────────────────────────────────────────────────────────────

def _run_ocr(path):
    try:
        import pytesseract
        from PIL import Image
        t = pytesseract.image_to_string(Image.open(path))
        return re.sub(r'\s+', ' ', t).strip()
    except Exception as e:
        print(f'OCR failed: {e}', flush=True)
        return ''


@app.route('/api/upload', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({'error': 'Empty filename'}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
        return jsonify({'error': 'Invalid file type'}), 400
    filename = str(uuid.uuid4()) + ext
    p = os.path.join(UPLOADS_DIR, filename)
    f.save(p)
    ocr = _load(OCR_FILE, {})
    ocr[filename] = _run_ocr(p)
    _save(OCR_FILE, ocr)
    return jsonify({'filename': filename, 'url': f'/uploads/{filename}'}), 201


@app.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(UPLOADS_DIR, filename)


# ── Search ───────────────────────────────────────────────────────────────────

def _text_from_excalidraw(snapshot):
    """Extract searchable text from an Excalidraw snapshot.

    Elements have `type` and optionally `text`. Image elements ref files by `fileId`.
    """
    out = []
    if not snapshot:
        return out
    elements = snapshot.get('elements') or []
    files = snapshot.get('files') or {}
    ocr = _load(OCR_FILE, {})
    for el in elements:
        if not isinstance(el, dict):
            continue
        t = el.get('type')
        if t == 'text':
            text = el.get('text') or ''
            if text.strip():
                out.append({'kind': 'text', 'text': text.strip()})
        elif t == 'frame':
            name = el.get('name') or ''
            if name.strip():
                out.append({'kind': 'frame', 'text': name.strip()})
        elif t == 'image':
            file_id = el.get('fileId')
            if file_id and file_id in files:
                data_url = files[file_id].get('dataURL') or ''
                # If backed by our uploads, find filename
                m = re.search(r'/uploads/([a-z0-9-]+\.[a-z]+)', data_url)
                if m:
                    fn = m.group(1)
                    ocr_text = ocr.get(fn, '')
                    if ocr_text:
                        out.append({'kind': 'ocr', 'text': ocr_text})
    return out


def _text_from_sheet(data):
    """Sheet data is [[{value}, ...], ...]."""
    out = []
    if not data:
        return out
    for row in data:
        if isinstance(row, list):
            for cell in row:
                if isinstance(cell, dict) and cell.get('value'):
                    out.append(str(cell['value']))
    return out


def _all_items():
    """Yield searchable entries: {doc_type, doc_id, doc_name, kind, text}."""
    boards = _load_boards()
    sheets = _load_sheets()
    for b in boards:
        data = _load(_board_file(b['id']), {'snapshot': None})
        for entry in _text_from_excalidraw(data.get('snapshot')):
            yield {
                'doc_type': 'board', 'doc_id': b['id'], 'doc_name': b['name'],
                'kind': entry['kind'], 'text': entry['text'],
            }
    for s in sheets:
        data = _load(_sheet_file(s['id']), {'data': []})
        for text in _text_from_sheet(data.get('data') or []):
            yield {
                'doc_type': 'sheet', 'doc_id': s['id'], 'doc_name': s['name'],
                'kind': 'sheet', 'text': text,
            }


# Lazy semantic model
_model = None
def _embed(text):
    global _model
    try:
        if _model is None:
            from sentence_transformers import SentenceTransformer
            print('Loading embedding model…', flush=True)
            _model = SentenceTransformer('all-MiniLM-L6-v2')
        return _model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
    except Exception as e:
        print(f'Embedding failed: {e}', flush=True)
        return None


def _keyword(text, q):
    t = text.lower(); q = q.lower().strip()
    score = 0.0
    if q in t: score += 1.0
    for w in q.split():
        if len(w) >= 2 and w in t: score += 0.2
    return score


@app.route('/api/search', methods=['POST'])
def search():
    body = request.json or {}
    q = (body.get('query') or '').strip()
    if not q:
        return jsonify({'hits': []})

    items = list(_all_items())
    if not items:
        return jsonify({'hits': []})

    try:
        import numpy as np
        q_vec = _embed(q)
    except Exception:
        q_vec = None

    hits = []
    for it in items:
        kw = _keyword(it['text'], q)
        sem = 0.0
        if q_vec is not None:
            try:
                import numpy as np
                v = _embed(it['text'])
                if v is not None:
                    sem = float(np.dot(q_vec, v))
            except Exception:
                pass
        combined = kw * 2.0 + sem
        if kw > 0 or sem > 0.35:
            hits.append({
                'doc_type': it['doc_type'],
                'doc_id': it['doc_id'],
                'doc_name': it['doc_name'],
                'kind': it['kind'],
                'snippet': it['text'][:220],
                'source': {
                    'text': 'text', 'frame': 'section', 'ocr': 'OCR from image',
                    'sheet': 'spreadsheet cell',
                }.get(it['kind'], it['kind']),
                'score': combined,
            })
    hits.sort(key=lambda h: h['score'], reverse=True)
    return jsonify({'hits': hits[:50]})


@app.route('/')
def root():
    i = os.path.join(STATIC_BUILD, 'index.html')
    if os.path.exists(i): return send_file(i)
    return 'Frontend not built yet. Run the Vite dev server.', 404


@app.route('/<path:path>')
def static_files(path):
    full = os.path.join(STATIC_BUILD, path)
    if os.path.exists(full):
        return send_from_directory(STATIC_BUILD, path)
    i = os.path.join(STATIC_BUILD, 'index.html')
    if os.path.exists(i): return send_file(i)
    return 'Not found', 404


if __name__ == '__main__':
    # Production-ish: debug off so unhandled exceptions don't kill the process mid-request
    app.run(debug=False, port=5001, host='0.0.0.0', threaded=True)
