"""Research Hub backend with studio auth and password-protected share links."""

import json
import os
import re
import secrets
import uuid
from datetime import datetime
from functools import wraps

from flask import Flask, jsonify, request, send_file, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
STATIC_BUILD = os.path.join(BASE_DIR, 'static_build')

BOARDS_FILE = os.path.join(DATA_DIR, 'boards.json')
SHEETS_FILE = os.path.join(DATA_DIR, 'sheets.json')
OCR_FILE = os.path.join(DATA_DIR, 'ocr.json')
WORKSPACE_FILE = os.path.join(DATA_DIR, 'workspace.json')
SHARES_FILE = os.path.join(DATA_DIR, 'shares.json')

PRODUCTION = bool(
    os.getenv('RENDER')
    or os.getenv('RENDER_EXTERNAL_URL')
    or os.getenv('RAILWAY_ENVIRONMENT')
    or os.getenv('COOKIE_SECURE', '').lower() in {'1', 'true', 'yes'}
)

app.secret_key = (
    os.getenv('FLASK_SECRET_KEY')
    or os.getenv('SECRET_KEY')
    or 'research-hub-dev-secret-change-me'
)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='None' if PRODUCTION else 'Lax',
    SESSION_COOKIE_SECURE=PRODUCTION,
)

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)


def _allowed_origins():
    defaults = {
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'https://YOUR_DOMAIN',
        'https://YOUR_DOMAIN',
    }
    raw = os.getenv('CORS_ALLOWED_ORIGINS', '')
    extra = {origin.strip() for origin in raw.split(',') if origin.strip()}
    return defaults | extra


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    if origin and origin in _allowed_origins():
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PATCH,PUT,DELETE,OPTIONS'
        response.headers['Vary'] = 'Origin'
    return response


@app.before_request
def handle_options():
    if request.method == 'OPTIONS':
        return ('', 204)


def _load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, 'r') as f:
        return json.load(f)


def _save(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def _board_file(item_id):
    return os.path.join(DATA_DIR, f'board-{item_id}.json')


def _sheet_file(item_id):
    return os.path.join(DATA_DIR, f'sheet-{item_id}.json')


def _studio_password():
    return os.getenv('STUDIO_PASSWORD') or os.getenv('RESEARCH_STUDIO_PASSWORD') or 'changeme'


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


def _parse_tags(raw):
    if isinstance(raw, list):
        return [str(t).strip().lstrip('#') for t in raw if str(t).strip()]
    if isinstance(raw, str):
        return [t.strip().lstrip('#') for t in raw.split(',') if t.strip()]
    return []


def _normalize_doc(item, folders):
    doc = dict(item or {})
    doc['folder_id'] = _normalize_folder_id(doc.get('folder_id'), folders)
    if 'tags' not in doc or not isinstance(doc.get('tags'), list):
        doc['tags'] = _parse_tags(doc.get('tags'))
    return doc


def _load_boards():
    folders = _get_workspace().get('folders', [])
    return [_normalize_doc(board, folders) for board in _load(BOARDS_FILE, [])]


def _save_boards(boards):
    folders = _get_workspace().get('folders', [])
    _save(BOARDS_FILE, [_normalize_doc(board, folders) for board in boards])


def _load_sheets():
    folders = _get_workspace().get('folders', [])
    return [_normalize_doc(sheet, folders) for sheet in _load(SHEETS_FILE, [])]


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


def _sanitize_parent_id(parent_id, folders, folder_id=None):
    parent_id = _normalize_folder_id(parent_id, folders)
    if folder_id and parent_id == folder_id:
        return None
    if folder_id and parent_id and _is_descendant(parent_id, folder_id, folders):
        return None
    return parent_id


def _normalize_share(item):
    share = dict(item or {})
    share['id'] = str(share.get('id') or str(uuid.uuid4())[:8])
    share['scope_type'] = share.get('scope_type') or 'workspace'
    share['scope_id'] = share.get('scope_id')
    share['token'] = str(share.get('token') or secrets.token_urlsafe(18))
    share['password_hash'] = share.get('password_hash') or ''
    share['revoked'] = bool(share.get('revoked'))
    share['created_at'] = share.get('created_at') or datetime.now().isoformat()
    share['label'] = (share.get('label') or '').strip()
    return share


def _load_shares():
    shares = _load(SHARES_FILE, [])
    normalized = [_normalize_share(share) for share in shares if isinstance(share, dict)]
    if normalized != shares:
        _save(SHARES_FILE, normalized)
    return normalized


def _save_shares(shares):
    _save(SHARES_FILE, [_normalize_share(share) for share in shares])


def _find_share_by_token(token):
    for share in _load_shares():
        if share.get('token') == token:
            return share
    return None


def _find_share_by_id(share_id):
    for share in _load_shares():
        if share.get('id') == share_id:
            return share
    return None


def _is_studio_authed():
    return bool(session.get('studio_authed'))


def _unlocked_share_tokens():
    raw = session.get('unlocked_share_tokens') or []
    return {token for token in raw if isinstance(token, str)}


def _unlock_share_token(token):
    unlocked = _unlocked_share_tokens()
    unlocked.add(token)
    session['unlocked_share_tokens'] = sorted(unlocked)
    session.modified = True


def _lock_share_token(token):
    unlocked = _unlocked_share_tokens()
    if token in unlocked:
        unlocked.remove(token)
        session['unlocked_share_tokens'] = sorted(unlocked)
        session.modified = True


def _share_is_unlocked(token):
    return token in _unlocked_share_tokens()


def _studio_auth_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not _is_studio_authed():
            return jsonify({'error': 'Studio password required'}), 401
        return fn(*args, **kwargs)
    return wrapped


def _active_share_or_401(token):
    share = _find_share_by_token(token)
    if not share or share.get('revoked'):
        return None, (jsonify({'error': 'Share not found'}), 404)
    if not _share_is_unlocked(token):
        return None, (jsonify({'error': 'Share password required', 'requires_password': True}), 401)
    return share, None


def _scope_label(share, boards=None, sheets=None, folders=None):
    boards = boards if boards is not None else _load_boards()
    sheets = sheets if sheets is not None else _load_sheets()
    folders = folders if folders is not None else _get_workspace().get('folders', [])
    scope_type = share.get('scope_type')
    scope_id = share.get('scope_id')
    if scope_type == 'board':
        board = next((item for item in boards if item.get('id') == scope_id), None)
        return board.get('name') if board else 'Board'
    if scope_type == 'sheet':
        sheet = next((item for item in sheets if item.get('id') == scope_id), None)
        return sheet.get('name') if sheet else 'Sheet'
    if scope_type == 'folder':
        folder = next((item for item in folders if item.get('id') == scope_id), None)
        return folder.get('name') if folder else 'Folder'
    return _get_workspace().get('name', 'Workspace')


def _scoped_share_payload(share):
    ws = _get_workspace()
    folders = ws.get('folders', [])
    boards = _load_boards()
    sheets = _load_sheets()
    scope_type = share.get('scope_type')
    scope_id = share.get('scope_id')

    scoped_folders = []
    scoped_boards = []
    scoped_sheets = []

    if scope_type == 'workspace':
        scoped_folders = [dict(folder) for folder in folders]
        scoped_boards = [dict(board) for board in boards]
        scoped_sheets = [dict(sheet) for sheet in sheets]
    elif scope_type == 'folder':
        folder_ids = _folder_with_descendants(scope_id, folders) if any(folder.get('id') == scope_id for folder in folders) else set()
        scoped_folders = []
        for folder in folders:
            if folder.get('id') not in folder_ids:
                continue
            parent_id = folder.get('parent_id')
            scoped_folders.append({
                **folder,
                'parent_id': parent_id if parent_id in folder_ids else None,
            })
        scoped_boards = [dict(board) for board in boards if board.get('folder_id') in folder_ids]
        scoped_sheets = [dict(sheet) for sheet in sheets if sheet.get('folder_id') in folder_ids]
    elif scope_type == 'board':
        board = next((item for item in boards if item.get('id') == scope_id), None)
        if board:
            scoped_boards = [{**board, 'folder_id': None}]
    elif scope_type == 'sheet':
        sheet = next((item for item in sheets if item.get('id') == scope_id), None)
        if sheet:
            scoped_sheets = [{**sheet, 'folder_id': None}]

    return {
        'share': {
            'id': share.get('id'),
            'label': share.get('label'),
            'scope_type': scope_type,
            'scope_id': scope_id,
            'title': share.get('label') or _scope_label(share, boards=boards, sheets=sheets, folders=folders),
        },
        'workspace': {
            'name': ws.get('name'),
            'owner': ws.get('owner'),
            'folders': scoped_folders,
        },
        'boards': scoped_boards,
        'sheets': scoped_sheets,
    }


def _share_allowed_doc_ids(share):
    payload = _scoped_share_payload(share)
    board_ids = {board.get('id') for board in payload['boards']}
    sheet_ids = {sheet.get('id') for sheet in payload['sheets']}
    return board_ids, sheet_ids


def _share_allows_board(share, board_id):
    board_ids, _ = _share_allowed_doc_ids(share)
    return board_id in board_ids


def _share_allows_sheet(share, sheet_id):
    _, sheet_ids = _share_allowed_doc_ids(share)
    return sheet_id in sheet_ids


def _snapshot_upload_filenames(snapshot):
    files = (snapshot or {}).get('files') or {}
    names = set()
    for file_data in files.values():
        data_url = file_data.get('dataURL') or ''
        match = re.search(r'/uploads/([a-z0-9-]+\.[a-z0-9]+)', data_url, flags=re.IGNORECASE)
        if match:
            names.add(match.group(1))
    return names


def _share_allows_upload(share, filename):
    payload = _scoped_share_payload(share)
    for board in payload['boards']:
        data = _load(_board_file(board['id']), {'snapshot': None})
        if filename in _snapshot_upload_filenames(data.get('snapshot')):
            return True
    return False


def _validate_share_scope(scope_type, scope_id):
    ws = _get_workspace()
    boards = _load_boards()
    sheets = _load_sheets()
    folders = ws.get('folders', [])

    if scope_type == 'workspace':
        return True
    if scope_type == 'board':
        return any(board.get('id') == scope_id for board in boards)
    if scope_type == 'sheet':
        return any(sheet.get('id') == scope_id for sheet in sheets)
    if scope_type == 'folder':
        return any(folder.get('id') == scope_id for folder in folders)
    return False


def _serialize_share_for_list(share):
    payload = _scoped_share_payload(share)
    return {
        'id': share.get('id'),
        'label': share.get('label'),
        'scope_type': share.get('scope_type'),
        'scope_id': share.get('scope_id'),
        'token': share.get('token'),
        'revoked': bool(share.get('revoked')),
        'created_at': share.get('created_at'),
        'title': payload['share']['title'],
        'url': f'/share/{share.get("token")}',
    }


@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    return jsonify({'authenticated': _is_studio_authed()})


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json or {}
    password = data.get('password') or ''
    if password != _studio_password():
        return jsonify({'error': 'Wrong password'}), 401
    session['studio_authed'] = True
    session.modified = True
    return jsonify({'authenticated': True})


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.pop('studio_authed', None)
    session.pop('unlocked_share_tokens', None)
    session.modified = True
    return '', 204


@app.route('/api/folders', methods=['POST'])
@_studio_auth_required
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
@_studio_auth_required
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
@_studio_auth_required
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
@_studio_auth_required
def get_workspace():
    ws = _get_workspace()
    ws.pop('public_slug', None)
    return jsonify(ws)


@app.route('/api/workspace', methods=['PATCH'])
@_studio_auth_required
def patch_workspace():
    ws = _get_workspace()
    data = request.json or {}
    if 'name' in data:
        ws['name'] = (data['name'] or '').strip() or ws['name']
    if 'owner' in data:
        ws['owner'] = (data['owner'] or '').strip()
    _save(WORKSPACE_FILE, ws)
    ws.pop('public_slug', None)
    return jsonify(ws)


@app.route('/api/shares', methods=['GET'])
@_studio_auth_required
def list_shares():
    shares = [_serialize_share_for_list(share) for share in _load_shares()]
    shares.sort(key=lambda share: share.get('created_at', ''), reverse=True)
    return jsonify(shares)


@app.route('/api/shares', methods=['POST'])
@_studio_auth_required
def create_share():
    data = request.json or {}
    scope_type = data.get('scope_type') or ''
    scope_id = data.get('scope_id')
    password = data.get('password') or ''
    label = (data.get('label') or '').strip()

    if scope_type not in {'board', 'sheet', 'folder', 'workspace'}:
        return jsonify({'error': 'Invalid share scope'}), 400
    if scope_type != 'workspace' and not scope_id:
        return jsonify({'error': 'Missing scope id'}), 400
    if not _validate_share_scope(scope_type, scope_id):
        return jsonify({'error': 'Scope not found'}), 404
    if len(password) < 3:
        return jsonify({'error': 'Share password must be at least 3 characters'}), 400

    share = _normalize_share({
        'id': str(uuid.uuid4())[:8],
        'scope_type': scope_type,
        'scope_id': scope_id,
        'token': secrets.token_urlsafe(18),
        'password_hash': generate_password_hash(password),
        'revoked': False,
        'created_at': datetime.now().isoformat(),
        'label': label,
    })
    shares = _load_shares()
    shares.append(share)
    _save_shares(shares)
    return jsonify(_serialize_share_for_list(share)), 201


@app.route('/api/shares/<share_id>', methods=['DELETE'])
@_studio_auth_required
def revoke_share(share_id):
    shares = _load_shares()
    changed = False
    for share in shares:
        if share.get('id') != share_id:
            continue
        share['revoked'] = True
        changed = True
        _lock_share_token(share.get('token'))
        break
    if not changed:
        return jsonify({'error': 'Share not found'}), 404
    _save_shares(shares)
    return '', 204


@app.route('/api/share/<token>/unlock', methods=['POST'])
def unlock_share(token):
    share = _find_share_by_token(token)
    if not share or share.get('revoked'):
        return jsonify({'error': 'Share not found'}), 404
    data = request.json or {}
    password = data.get('password') or ''
    if not check_password_hash(share.get('password_hash') or '', password):
        return jsonify({'error': 'Wrong password'}), 401
    _unlock_share_token(token)
    return jsonify({'ok': True})


@app.route('/api/share/<token>/lock', methods=['POST'])
def lock_share(token):
    _lock_share_token(token)
    return '', 204


@app.route('/api/share/<token>', methods=['GET'])
def share_by_token(token):
    share, error = _active_share_or_401(token)
    if error:
        return error
    return jsonify(_scoped_share_payload(share))


@app.route('/api/share/<token>/board/<board_id>', methods=['GET'])
def share_board(token, board_id):
    share, error = _active_share_or_401(token)
    if error:
        return error
    if not _share_allows_board(share, board_id):
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_load(_board_file(board_id), {'snapshot': None}))


@app.route('/api/share/<token>/sheet/<sheet_id>', methods=['GET'])
def share_sheet(token, sheet_id):
    share, error = _active_share_or_401(token)
    if error:
        return error
    if not _share_allows_sheet(share, sheet_id):
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_load(_sheet_file(sheet_id), {'data': []}))


# ── Boards ───────────────────────────────────────────────────────────────────

@app.route('/api/boards', methods=['GET'])
@_studio_auth_required
def list_boards():
    boards = _load_boards()
    boards.sort(key=lambda item: item.get('created_at', ''), reverse=True)
    return jsonify(boards)


@app.route('/api/boards', methods=['POST'])
@_studio_auth_required
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
@_studio_auth_required
def patch_board(board_id):
    data = request.json or {}
    boards = _load_boards()
    folders = _get_workspace().get('folders', [])
    for board in boards:
        if board['id'] != board_id:
            continue
        if 'name' in data:
            board['name'] = (data['name'] or '').strip() or board.get('name', 'Untitled')
        if 'tags' in data:
            board['tags'] = _parse_tags(data['tags'])
        if 'folder_id' in data:
            board['folder_id'] = _normalize_folder_id(data.get('folder_id'), folders)
        _save_boards(boards)
        return jsonify(board)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/boards/<board_id>', methods=['DELETE'])
@_studio_auth_required
def delete_board(board_id):
    boards = [board for board in _load_boards() if board['id'] != board_id]
    _save_boards(boards)
    fp = _board_file(board_id)
    if os.path.exists(fp):
        os.remove(fp)
    return '', 204


@app.route('/api/boards/<board_id>', methods=['GET'])
@_studio_auth_required
def get_board(board_id):
    return jsonify(_load(_board_file(board_id), {'snapshot': None}))


@app.route('/api/boards/<board_id>', methods=['PUT'])
@_studio_auth_required
def update_board(board_id):
    data = request.json or {}
    _save(_board_file(board_id), {'snapshot': data.get('snapshot')})
    return '', 204


# ── Sheets ───────────────────────────────────────────────────────────────────

@app.route('/api/sheets', methods=['GET'])
@_studio_auth_required
def list_sheets():
    sheets = _load_sheets()
    sheets.sort(key=lambda item: item.get('created_at', ''), reverse=True)
    return jsonify(sheets)


@app.route('/api/sheets', methods=['POST'])
@_studio_auth_required
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
@_studio_auth_required
def patch_sheet(sheet_id):
    data = request.json or {}
    sheets = _load_sheets()
    folders = _get_workspace().get('folders', [])
    for sheet in sheets:
        if sheet['id'] != sheet_id:
            continue
        if 'name' in data:
            sheet['name'] = (data['name'] or '').strip() or sheet.get('name', 'Untitled')
        if 'tags' in data:
            sheet['tags'] = _parse_tags(data['tags'])
        if 'folder_id' in data:
            sheet['folder_id'] = _normalize_folder_id(data.get('folder_id'), folders)
        _save_sheets(sheets)
        return jsonify(sheet)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/sheets/<sheet_id>', methods=['DELETE'])
@_studio_auth_required
def delete_sheet(sheet_id):
    sheets = [sheet for sheet in _load_sheets() if sheet['id'] != sheet_id]
    _save_sheets(sheets)
    fp = _sheet_file(sheet_id)
    if os.path.exists(fp):
        os.remove(fp)
    return '', 204


@app.route('/api/sheets/<sheet_id>', methods=['GET'])
@_studio_auth_required
def get_sheet(sheet_id):
    return jsonify(_load(_sheet_file(sheet_id), {'data': []}))


@app.route('/api/sheets/<sheet_id>', methods=['PUT'])
@_studio_auth_required
def update_sheet(sheet_id):
    data = request.json or {}
    _save(_sheet_file(sheet_id), {'data': data.get('data') or []})
    return '', 204


# ── Uploads + OCR ────────────────────────────────────────────────────────────

def _run_ocr(path):
    try:
        import pytesseract
        from PIL import Image
        text = pytesseract.image_to_string(Image.open(path))
        return re.sub(r'\s+', ' ', text).strip()
    except Exception as exc:
        print(f'OCR failed: {exc}', flush=True)
        return ''


@app.route('/api/upload', methods=['POST'])
@_studio_auth_required
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    uploaded = request.files['file']
    if not uploaded.filename:
        return jsonify({'error': 'Empty filename'}), 400
    ext = os.path.splitext(uploaded.filename)[1].lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
        return jsonify({'error': 'Invalid file type'}), 400
    filename = str(uuid.uuid4()) + ext
    path = os.path.join(UPLOADS_DIR, filename)
    uploaded.save(path)
    ocr = _load(OCR_FILE, {})
    ocr[filename] = _run_ocr(path)
    _save(OCR_FILE, ocr)
    return jsonify({'filename': filename, 'url': f'/uploads/{filename}'}), 201


@app.route('/uploads/<filename>')
def serve_upload(filename):
    if _is_studio_authed():
        return send_from_directory(UPLOADS_DIR, filename)
    for token in _unlocked_share_tokens():
        share = _find_share_by_token(token)
        if share and not share.get('revoked') and _share_allows_upload(share, filename):
            return send_from_directory(UPLOADS_DIR, filename)
    return jsonify({'error': 'Not found'}), 404


# ── Search ───────────────────────────────────────────────────────────────────

def _text_from_excalidraw(snapshot):
    out = []
    if not snapshot:
        return out
    elements = snapshot.get('elements') or []
    files = snapshot.get('files') or {}
    ocr = _load(OCR_FILE, {})
    for element in elements:
        if not isinstance(element, dict):
            continue
        element_type = element.get('type')
        if element_type == 'text':
            text = element.get('text') or ''
            if text.strip():
                out.append({'kind': 'text', 'text': text.strip()})
        elif element_type == 'frame':
            name = element.get('name') or ''
            if name.strip():
                out.append({'kind': 'frame', 'text': name.strip()})
        elif element_type == 'image':
            file_id = element.get('fileId')
            if file_id and file_id in files:
                data_url = files[file_id].get('dataURL') or ''
                match = re.search(r'/uploads/([a-z0-9-]+\.[a-z]+)', data_url)
                if match:
                    filename = match.group(1)
                    ocr_text = ocr.get(filename, '')
                    if ocr_text:
                        out.append({'kind': 'ocr', 'text': ocr_text})
    return out


def _text_from_sheet(data):
    out = []
    if not data:
        return out
    for row in data:
        if isinstance(row, list):
            for cell in row:
                if isinstance(cell, dict) and cell.get('value'):
                    out.append(str(cell['value']))
    return out


def _all_items(boards=None, sheets=None):
    board_items = boards if boards is not None else _load_boards()
    sheet_items = sheets if sheets is not None else _load_sheets()
    for board in board_items:
        data = _load(_board_file(board['id']), {'snapshot': None})
        for entry in _text_from_excalidraw(data.get('snapshot')):
            yield {
                'doc_type': 'board',
                'doc_id': board['id'],
                'doc_name': board['name'],
                'kind': entry['kind'],
                'text': entry['text'],
            }
    for sheet in sheet_items:
        data = _load(_sheet_file(sheet['id']), {'data': []})
        for text in _text_from_sheet(data.get('data') or []):
            yield {
                'doc_type': 'sheet',
                'doc_id': sheet['id'],
                'doc_name': sheet['name'],
                'kind': 'sheet',
                'text': text,
            }


_model = None


def _embed(text):
    global _model
    try:
        if _model is None:
            from sentence_transformers import SentenceTransformer
            print('Loading embedding model…', flush=True)
            _model = SentenceTransformer('all-MiniLM-L6-v2')
        return _model.encode(text, convert_to_numpy=True, normalize_embeddings=True)
    except Exception as exc:
        print(f'Embedding failed: {exc}', flush=True)
        return None


def _keyword(text, query):
    haystack = text.lower()
    needle = query.lower().strip()
    score = 0.0
    if needle in haystack:
        score += 1.0
    for word in needle.split():
        if len(word) >= 2 and word in haystack:
            score += 0.2
    return score


def _search_payload(boards=None, sheets=None):
    body = request.json or {}
    query = (body.get('query') or '').strip()
    if not query:
        return {'hits': []}

    items = list(_all_items(boards=boards, sheets=sheets))
    if not items:
        return {'hits': []}

    try:
        import numpy as np
        query_vector = _embed(query)
    except Exception:
        query_vector = None

    hits = []
    for item in items:
        keyword_score = _keyword(item['text'], query)
        semantic_score = 0.0
        if query_vector is not None:
            try:
                import numpy as np
                item_vector = _embed(item['text'])
                if item_vector is not None:
                    semantic_score = float(np.dot(query_vector, item_vector))
            except Exception:
                pass
        combined = keyword_score * 2.0 + semantic_score
        if keyword_score > 0 or semantic_score > 0.35:
            hits.append({
                'doc_type': item['doc_type'],
                'doc_id': item['doc_id'],
                'doc_name': item['doc_name'],
                'kind': item['kind'],
                'snippet': item['text'][:220],
                'source': {
                    'text': 'text',
                    'frame': 'section',
                    'ocr': 'OCR from image',
                    'sheet': 'spreadsheet cell',
                }.get(item['kind'], item['kind']),
                'score': combined,
            })
    hits.sort(key=lambda hit: hit['score'], reverse=True)
    return {'hits': hits[:50]}


@app.route('/api/search', methods=['POST'])
@_studio_auth_required
def search():
    return jsonify(_search_payload())


@app.route('/api/share/<token>/search', methods=['POST'])
def share_search(token):
    share, error = _active_share_or_401(token)
    if error:
        return error
    payload = _scoped_share_payload(share)
    return jsonify(_search_payload(boards=payload['boards'], sheets=payload['sheets']))


@app.route('/')
def root():
    index_file = os.path.join(STATIC_BUILD, 'index.html')
    if os.path.exists(index_file):
        return send_file(index_file)
    return 'Frontend not built yet. Run the Vite dev server.', 404


@app.route('/<path:path>')
def static_files(path):
    full_path = os.path.join(STATIC_BUILD, path)
    if os.path.exists(full_path):
        return send_from_directory(STATIC_BUILD, path)
    index_file = os.path.join(STATIC_BUILD, 'index.html')
    if os.path.exists(index_file):
        return send_file(index_file)
    return 'Not found', 404


if __name__ == '__main__':
    app.run(debug=False, port=5001, host='0.0.0.0', threaded=True)
