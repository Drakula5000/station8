"""Research Hub backend with studio auth and password-protected share links."""

import json
import os
import re
import secrets
import shutil
import threading
import time
import uuid
from datetime import datetime
from functools import wraps

from flask import Flask, jsonify, request, send_file, send_from_directory, session, redirect
from werkzeug.security import check_password_hash, generate_password_hash
from supabase import create_client, Client

app = Flask(__name__)

# Supabase Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase: Client = None

if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("Supabase connected successfully!", flush=True)
    except Exception as e:
        print(f"Supabase connection failed: {e}", flush=True)
else:
    print("Supabase credentials missing from environment variables!", flush=True)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_RENDER_STORAGE_ROOT = (
    '/var/data'
    if (os.getenv('RENDER') or os.getenv('RENDER_EXTERNAL_URL')) and os.path.isdir('/var/data')
    else BASE_DIR
)
STORAGE_ROOT = os.path.abspath(os.getenv('S8_STORAGE_DIR') or DEFAULT_RENDER_STORAGE_ROOT)
DATA_DIR = os.path.abspath(os.getenv('S8_DATA_DIR') or os.path.join(STORAGE_ROOT, 'data'))
UPLOADS_DIR = os.path.abspath(os.getenv('S8_UPLOADS_DIR') or os.path.join(STORAGE_ROOT, 'uploads'))
STATIC_BUILD = os.path.join(BASE_DIR, 'static_build')
LEGACY_DATA_DIR = os.path.join(BASE_DIR, 'data')
LEGACY_UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')

BOARDS_FILE = os.path.join(DATA_DIR, 'boards.json')
SHEETS_FILE = os.path.join(DATA_DIR, 'sheets.json')
OCR_FILE = os.path.join(DATA_DIR, 'ocr.json')
WORKSPACE_FILE = os.path.join(DATA_DIR, 'workspace.json')
SHARES_FILE = os.path.join(DATA_DIR, 'shares.json')
AUTH_FILE = os.path.join(DATA_DIR, 'auth.json')

PRODUCTION = bool(
    os.getenv('RENDER')
    or os.getenv('RENDER_EXTERNAL_URL')
    or os.getenv('RAILWAY_ENVIRONMENT')
    or os.getenv('COOKIE_SECURE', '').lower() in {'1', 'true', 'yes'}
)


def _env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


ALLOW_BROWSER_AUTH_SETUP = _env_flag('S8_ALLOW_PROD_AUTH_SETUP', default=not PRODUCTION)

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

def _dir_has_files(path):
    return os.path.isdir(path) and any(os.scandir(path))


def _copy_tree_contents(src, dst):
    if not os.path.isdir(src):
        return
    os.makedirs(dst, exist_ok=True)
    for entry in os.scandir(src):
        src_path = entry.path
        dst_path = os.path.join(dst, entry.name)
        if entry.is_dir():
            shutil.copytree(src_path, dst_path, dirs_exist_ok=True)
        else:
            shutil.copy2(src_path, dst_path)


def _migrate_legacy_storage():
    if os.path.abspath(DATA_DIR) != os.path.abspath(LEGACY_DATA_DIR) and not _dir_has_files(DATA_DIR):
        _copy_tree_contents(LEGACY_DATA_DIR, DATA_DIR)
    if os.path.abspath(UPLOADS_DIR) != os.path.abspath(LEGACY_UPLOADS_DIR) and not _dir_has_files(UPLOADS_DIR):
        _copy_tree_contents(LEGACY_UPLOADS_DIR, UPLOADS_DIR)


os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
_migrate_legacy_storage()


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
    if request.path.startswith('/api/auth/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
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
    # Try Supabase first if configured
    if supabase:
        try:
            # Use the filename (relative to DATA_DIR) as the ID
            file_id = os.path.basename(path)
            response = supabase.table('json_storage').select('data').eq('id', file_id).execute()
            if response.data:
                return response.data[0]['data']
        except Exception as exc:
            print(f"Supabase load failed for {path}: {exc}", flush=True)

    # Fallback to local file
    if not os.path.exists(path):
        return default
    with open(path, 'r') as f:
        return json.load(f)


def _load_local_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except Exception:
        return default


def _save(path, data):
    # Save to Supabase first if configured
    if supabase:
        try:
            file_id = os.path.basename(path)
            supabase.table('json_storage').upsert({
                'id': file_id,
                'data': data
            }).execute()
        except Exception as exc:
            print(f"Supabase save failed for {path}: {exc}", flush=True)

    # Always save to local file as well (as a cache/backup)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def _board_file(item_id):
    return os.path.join(DATA_DIR, f'board-{item_id}.json')


def _sheet_file(item_id):
    return os.path.join(DATA_DIR, f'sheet-{item_id}.json')


def _env_studio_password():
    return (
        os.getenv('OWNER_PASSWORD')
        or os.getenv('STUDIO_PASSWORD')
        or os.getenv('RESEARCH_OWNER_PASSWORD')
        or os.getenv('RESEARCH_STUDIO_PASSWORD')
    )


def _env_visitor_password():
    return (
        os.getenv('VISITOR_PASSWORD')
        or os.getenv('RESEARCH_VISITOR_PASSWORD')
    )


def _load_auth_config():
    primary_auth = _load(AUTH_FILE, {})
    local_auth = _load_local_json(AUTH_FILE, {})
    legacy_auth = _load_local_json(os.path.join(LEGACY_DATA_DIR, 'auth.json'), {})

    auth = {}
    for candidate in (primary_auth, local_auth, legacy_auth):
        if not isinstance(candidate, dict):
            continue
        for key in ('studio_password_hash', 'visitor_password_hash', 'configured_at'):
            value = candidate.get(key)
            if value and not auth.get(key):
                auth[key] = value

    # Heal storage drift: if one source has the passwords and another is empty/stale,
    # sync the merged auth config back to the primary store.
    if auth and (primary_auth != auth or local_auth != auth):
        _save(AUTH_FILE, auth)

    return auth


def _save_auth_config(auth):
    _save(AUTH_FILE, auth)


def _stored_studio_password_hash():
    return _load_auth_config().get('studio_password_hash') or ''


def _stored_visitor_password_hash():
    return _load_auth_config().get('visitor_password_hash') or ''


def _owner_password_configured():
    return bool(_env_studio_password() or _stored_studio_password_hash())


def _visitor_password_configured():
    return bool(_env_visitor_password() or _stored_visitor_password_hash())


def _requires_access_setup():
    return not _owner_password_configured() or not _visitor_password_configured()


def _auth_configured():
    return not _requires_access_setup()


def _verify_studio_password(password):
    env_password = _env_studio_password()
    if env_password is not None:
        return password == env_password
    stored_hash = _stored_studio_password_hash()
    if not stored_hash:
        return False
    return check_password_hash(stored_hash, password)


def _verify_visitor_password(password):
    env_password = _env_visitor_password()
    if env_password is not None:
        return password == env_password
    stored_hash = _stored_visitor_password_hash()
    if not stored_hash:
        return False
    return check_password_hash(stored_hash, password)


def _normalize_folder_id(folder_id, folders):
    if folder_id in (None, '', 'null'):
        return None
    folder_ids = {f.get('id') for f in folders}
    return folder_id if folder_id in folder_ids else None


def _normalize_workspace(ws):
    ws = dict(ws or {})
    if not ws.get('name'):
        ws['name'] = 'Station 8'
    if 'owner' not in ws:
        ws['owner'] = ''
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
            'private': folder.get('private'),
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
            'name': 'Station 8',
            'owner': '',
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


VALID_THEMES = {'aurora', 'glass', 'hud', 'abyss', 'archive', 'prism'}
DEFAULT_BOARD_THEME = 'glass'


def _normalize_doc(item, folders):
    doc = dict(item or {})
    doc['folder_id'] = _normalize_folder_id(doc.get('folder_id'), folders)
    if 'tags' not in doc or not isinstance(doc.get('tags'), list):
        doc['tags'] = _parse_tags(doc.get('tags'))
    return doc


def _normalize_board(board, folders):
    doc = _normalize_doc(board, folders)
    theme = doc.get('theme')
    if theme not in VALID_THEMES:
        doc['theme'] = DEFAULT_BOARD_THEME
    return doc


def _load_boards():
    folders = _get_workspace().get('folders', [])
    return [_normalize_board(board, folders) for board in _load(BOARDS_FILE, [])]


def _save_boards(boards):
    folders = _get_workspace().get('folders', [])
    _save(BOARDS_FILE, [_normalize_board(board, folders) for board in boards])


def _load_sheets():
    folders = _get_workspace().get('folders', [])
    return [_normalize_doc(sheet, folders) for sheet in _load(SHEETS_FILE, [])]


def _save_sheets(sheets):
    folders = _get_workspace().get('folders', [])
    _save(SHEETS_FILE, [_normalize_doc(sheet, folders) for sheet in sheets])


def _any_ancestor_private(folder_id, folders):
    folder_map = {f['id']: f for f in folders}
    fid = folder_id
    visited = set()
    while fid and fid not in visited:
        visited.add(fid)
        f = folder_map.get(fid)
        if not f:
            return False
        fp = f.get('private')
        if fp is True:
            return True
        if fp is False:
            return False
        fid = f.get('parent_id')
    return False


def _folder_is_visitor_visible(folder, folders):
    fp = folder.get('private')
    if fp is True:
        return False
    if fp is False:
        return True
    return not _any_ancestor_private(folder.get('parent_id'), folders)


def _doc_is_visitor_visible(doc, folders):
    dp = doc.get('private')
    if dp is True:
        return False
    if dp is False:
        return True
    return not _any_ancestor_private(doc.get('folder_id'), folders)


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


def _move_direct_docs_from_folder(folder_id, target_parent_id):
    _move_docs_from_folder({folder_id}, target_parent_id)


def _reparent_child_folders(folder_id, folders, target_parent_id):
    for folder in folders:
        if folder.get('parent_id') == folder_id:
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


def _is_studio_authed():
    return bool(session.get('studio_authed'))


def _is_visitor_authed():
    return bool(session.get('visitor_authed'))


def _current_access_level():
    if _is_studio_authed():
        return 'owner'
    if _is_visitor_authed():
        return 'visitor'
    return None


def _studio_auth_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not _is_studio_authed():
            return jsonify({'error': 'Studio password required'}), 401
        return fn(*args, **kwargs)
    return wrapped


def _viewer_auth_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not (_is_studio_authed() or _is_visitor_authed()):
            return jsonify({'error': 'Password required'}), 401
        return fn(*args, **kwargs)
    return wrapped


def _active_share_or_401(token):
    share = _find_share_by_token(token)
    if not share or share.get('revoked'):
        return None, (jsonify({'error': 'Share not found'}), 404)
    if not (_is_visitor_authed() or _is_studio_authed()):
        return None, (jsonify({'error': 'Visitor password required', 'requires_password': True}), 401)
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


def _board_upload_filenames(board_id):
    data = _load(_board_file(board_id), {'snapshot': None})
    return _snapshot_upload_filenames(data.get('snapshot'))


def _uploads_referenced_by_boards(board_ids=None):
    allowed_ids = set(board_ids) if board_ids is not None else None
    names = set()
    for board in _load_boards():
        board_id = board.get('id')
        if allowed_ids is not None and board_id not in allowed_ids:
            continue
        names.update(_board_upload_filenames(board_id))
    return names


def _delete_upload_artifacts(filenames):
    if not filenames:
        return

    ocr = _load(OCR_FILE, {})
    updated_ocr = False
    for filename in filenames:
        path = os.path.join(UPLOADS_DIR, filename)
        if os.path.exists(path):
            os.remove(path)
        if filename in ocr:
            ocr.pop(filename, None)
            updated_ocr = True
    if updated_ocr:
        _save(OCR_FILE, ocr)


def _cleanup_unreferenced_uploads(candidate_filenames):
    if not candidate_filenames:
        return
    still_used = _uploads_referenced_by_boards()
    unused = {filename for filename in candidate_filenames if filename not in still_used}
    _delete_upload_artifacts(unused)


def _delete_board_files(board_ids):
    for board_id in board_ids:
        fp = _board_file(board_id)
        if os.path.exists(fp):
            os.remove(fp)


def _delete_sheet_files(sheet_ids):
    for sheet_id in sheet_ids:
        fp = _sheet_file(sheet_id)
        if os.path.exists(fp):
            os.remove(fp)


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
    return jsonify({
        'authenticated': bool(_current_access_level()),
        'access': _current_access_level(),
        'owner_authenticated': _is_studio_authed(),
        'visitor_authenticated': _is_visitor_authed(),
        'configured': _auth_configured(),
        'setup_allowed': ALLOW_BROWSER_AUTH_SETUP,
        'requires_setup': _requires_access_setup() and ALLOW_BROWSER_AUTH_SETUP,
    })


@app.route('/api/auth/setup', methods=['POST'])
def auth_setup():
    if not ALLOW_BROWSER_AUTH_SETUP:
        return jsonify({
            'error': 'Browser-based password setup is disabled in production. Configure STUDIO_PASSWORD and VISITOR_PASSWORD on the server.',
            'setup_allowed': False,
        }), 403
    if not _requires_access_setup():
        return jsonify({'error': 'Access passwords are already configured'}), 409
    data = request.json or {}
    owner_password = data.get('owner_password') or ''
    visitor_password = data.get('visitor_password') or ''
    auth = _load_auth_config()
    if not _owner_password_configured():
        if len(owner_password) < 6:
            return jsonify({'error': 'Workspace password must be at least 6 characters'}), 400
        auth['studio_password_hash'] = generate_password_hash(owner_password)
    if not _visitor_password_configured():
        if len(visitor_password) < 6:
            return jsonify({'error': 'Visitor password must be at least 6 characters'}), 400
        auth['visitor_password_hash'] = generate_password_hash(visitor_password)
    auth['configured_at'] = datetime.now().isoformat()
    _save_auth_config(auth)
    session['studio_authed'] = True
    session.pop('visitor_authed', None)
    session.modified = True
    return jsonify({'authenticated': True, 'requires_setup': False, 'access': 'owner'})


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json or {}
    password = data.get('password') or ''
    if _requires_access_setup():
        if ALLOW_BROWSER_AUTH_SETUP:
            return jsonify({'error': 'Access passwords have not been set up yet', 'requires_setup': True, 'setup_allowed': True}), 409
        return jsonify({
            'error': 'Access is not configured on the server.',
            'requires_setup': False,
            'configured': False,
            'setup_allowed': False,
        }), 503
    if _verify_studio_password(password):
        session['studio_authed'] = True
        session.pop('visitor_authed', None)
        session.modified = True
        return jsonify({'authenticated': True, 'access': 'owner'})
    if not _verify_visitor_password(password):
        return jsonify({'error': 'Wrong password'}), 401
    session['visitor_authed'] = True
    session.pop('studio_authed', None)
    session.modified = True
    return jsonify({'authenticated': True, 'access': 'visitor'})


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.pop('studio_authed', None)
    session.pop('visitor_authed', None)
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
        if 'private' in data:
            folder['private'] = True if data['private'] is True else (False if data['private'] is False else None)
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

    target_parent_id = target.get('parent_id')
    mode = (request.args.get('mode') or 'move').strip().lower()
    if mode not in {'move', 'delete'}:
        return jsonify({'error': 'Invalid delete mode'}), 400

    if mode == 'move':
        remaining = [folder for folder in folders if folder['id'] != folder_id]
        _move_direct_docs_from_folder(folder_id, target_parent_id)
        _reparent_child_folders(folder_id, remaining, target_parent_id)
        ws['folders'] = remaining
        _save(WORKSPACE_FILE, ws)
        return '', 204

    folder_ids = _folder_with_descendants(folder_id, folders)
    boards_to_delete = [board for board in _load_boards() if board.get('folder_id') in folder_ids]
    sheets_to_delete = [sheet for sheet in _load_sheets() if sheet.get('folder_id') in folder_ids]
    board_ids = [board.get('id') for board in boards_to_delete if board.get('id')]
    sheet_ids = [sheet.get('id') for sheet in sheets_to_delete if sheet.get('id')]
    upload_filenames = set()
    for board_id in board_ids:
        upload_filenames.update(_board_upload_filenames(board_id))

    remaining = [folder for folder in folders if folder['id'] not in folder_ids]
    if board_ids:
        _save_boards([board for board in _load_boards() if board.get('id') not in set(board_ids)])
        _delete_board_files(board_ids)
    if sheet_ids:
        _save_sheets([sheet for sheet in _load_sheets() if sheet.get('id') not in set(sheet_ids)])
        _delete_sheet_files(sheet_ids)
    ws['folders'] = remaining
    _save(WORKSPACE_FILE, ws)
    _cleanup_unreferenced_uploads(upload_filenames)
    return '', 204


@app.route('/api/workspace', methods=['GET'])
@_studio_auth_required
def get_workspace():
    ws = _get_workspace()
    return jsonify(ws)


@app.route('/api/visitor/workspace', methods=['GET'])
@_viewer_auth_required
def get_visitor_workspace():
    ws = _get_workspace()
    folders = ws.get('folders', [])
    visible = [f for f in folders if _folder_is_visitor_visible(f, folders)]
    ws = dict(ws)
    ws['folders'] = visible
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
    label = (data.get('label') or '').strip()

    if scope_type not in {'board', 'sheet', 'folder', 'workspace'}:
        return jsonify({'error': 'Invalid share scope'}), 400
    if scope_type != 'workspace' and not scope_id:
        return jsonify({'error': 'Missing scope id'}), 400
    if not _validate_share_scope(scope_type, scope_id):
        return jsonify({'error': 'Scope not found'}), 404

    share = _normalize_share({
        'id': str(uuid.uuid4())[:8],
        'scope_type': scope_type,
        'scope_id': scope_id,
        'token': secrets.token_urlsafe(18),
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
        break
    if not changed:
        return jsonify({'error': 'Share not found'}), 404
    _save_shares(shares)
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
    return jsonify(_board_payload_with_assets(board_id))


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


@app.route('/api/visitor/boards', methods=['GET'])
@_viewer_auth_required
def list_visitor_boards():
    folders = _get_workspace().get('folders', [])
    boards = [b for b in _load_boards() if _doc_is_visitor_visible(b, folders)]
    boards.sort(key=lambda item: item.get('created_at', ''), reverse=True)
    return jsonify(boards)


@app.route('/api/boards', methods=['POST'])
@_studio_auth_required
def create_board():
    data = request.json or {}
    name = (data.get('name') or 'Untitled').strip() or 'Untitled'
    folders = _get_workspace().get('folders', [])
    requested_theme = data.get('theme') if data.get('theme') in VALID_THEMES else DEFAULT_BOARD_THEME
    board = {
        'id': str(uuid.uuid4())[:8],
        'name': name,
        'tags': _parse_tags(data.get('tags')),
        'folder_id': _normalize_folder_id(data.get('folder_id'), folders),
        'theme': requested_theme,
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
        if 'private' in data:
            board['private'] = True if data['private'] is True else (False if data['private'] is False else None)
        if 'theme' in data:
            theme = data.get('theme')
            if theme in VALID_THEMES:
                board['theme'] = theme
        _save_boards(boards)
        return jsonify(board)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/boards/<board_id>', methods=['DELETE'])
@_studio_auth_required
def delete_board(board_id):
    upload_filenames = _board_upload_filenames(board_id)
    boards = [board for board in _load_boards() if board['id'] != board_id]
    _save_boards(boards)
    _delete_board_files([board_id])
    _cleanup_unreferenced_uploads(upload_filenames)
    return '', 204


@app.route('/api/boards/<board_id>', methods=['GET'])
@_studio_auth_required
def get_board(board_id):
    return jsonify(_board_payload_with_assets(board_id))


@app.route('/api/visitor/boards/<board_id>', methods=['GET'])
@_viewer_auth_required
def get_visitor_board(board_id):
    folders = _get_workspace().get('folders', [])
    board = next((b for b in _load_boards() if b['id'] == board_id), None)
    if not board or not _doc_is_visitor_visible(board, folders):
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_board_payload_with_assets(board_id))


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


@app.route('/api/visitor/sheets', methods=['GET'])
@_viewer_auth_required
def list_visitor_sheets():
    folders = _get_workspace().get('folders', [])
    sheets = [s for s in _load_sheets() if _doc_is_visitor_visible(s, folders)]
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
        if 'private' in data:
            sheet['private'] = True if data['private'] is True else (False if data['private'] is False else None)
        _save_sheets(sheets)
        return jsonify(sheet)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/sheets/<sheet_id>', methods=['DELETE'])
@_studio_auth_required
def delete_sheet(sheet_id):
    sheets = [sheet for sheet in _load_sheets() if sheet['id'] != sheet_id]
    _save_sheets(sheets)
    _delete_sheet_files([sheet_id])
    return '', 204


@app.route('/api/sheets/<sheet_id>', methods=['GET'])
@_studio_auth_required
def get_sheet(sheet_id):
    return jsonify(_load(_sheet_file(sheet_id), {'data': []}))


@app.route('/api/visitor/sheets/<sheet_id>', methods=['GET'])
@_viewer_auth_required
def get_visitor_sheet(sheet_id):
    folders = _get_workspace().get('folders', [])
    sheet = next((s for s in _load_sheets() if s['id'] == sheet_id), None)
    if not sheet or not _doc_is_visitor_visible(sheet, folders):
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_load(_sheet_file(sheet_id), {'data': []}))


@app.route('/api/sheets/<sheet_id>', methods=['PUT'])
@_studio_auth_required
def update_sheet(sheet_id):
    data = request.json or {}
    _save(_sheet_file(sheet_id), {'data': data.get('data') or []})
    return '', 204


# ── Uploads + OCR ────────────────────────────────────────────────────────────

# Images render on the canvas at a few hundred pixels wide at most. Full-res
# phone photos (4000×3000, 2–3 MB PNG) are absurd overkill and dominate the
# board-load time on any non-fast connection. Cap the largest dimension and
# re-compress on upload so the wire payload shrinks 5–20×.
IMAGE_MAX_DIMENSION = 2000
IMAGE_JPEG_QUALITY = 85
IMAGE_WEBP_QUALITY = 85


def _png_has_transparency(img):
    if img.mode == 'RGBA':
        alpha = img.getchannel('A')
        return alpha.getextrema()[0] < 255
    if img.mode == 'LA':
        return True
    if img.mode == 'P' and 'transparency' in img.info:
        return True
    return False


def _optimize_image(path, allow_rename=True):
    """Resize and recompress an image in place. Returns the final path
    (may differ from input if we converted an opaque PNG to JPEG and
    allow_rename is True), or None on failure. Safe to call repeatedly.

    allow_rename=False keeps the filename stable — use this for existing
    uploads already referenced by board snapshots. New uploads can rename
    freely since the returned URL is what the client stores."""
    try:
        from PIL import Image, ImageOps
    except Exception:
        return None
    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            ext = os.path.splitext(path)[1].lower()
            width, height = img.size
            longest = max(width, height)
            if longest > IMAGE_MAX_DIMENSION:
                scale = IMAGE_MAX_DIMENSION / longest
                img = img.resize((int(width * scale), int(height * scale)), Image.LANCZOS)

            if ext == '.png' and allow_rename and not _png_has_transparency(img):
                # Opaque PNG → JPEG is typically a 5–10× size win for photos.
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                new_path = os.path.splitext(path)[0] + '.jpg'
                img.save(new_path, format='JPEG', quality=IMAGE_JPEG_QUALITY, optimize=True, progressive=True)
                if new_path != path and os.path.exists(path):
                    os.remove(path)
                return new_path

            if ext in ('.jpg', '.jpeg'):
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                img.save(path, format='JPEG', quality=IMAGE_JPEG_QUALITY, optimize=True, progressive=True)
                return path
            if ext == '.png':
                img.save(path, format='PNG', optimize=True, compress_level=9)
                return path
            if ext == '.webp':
                img.save(path, format='WEBP', quality=IMAGE_WEBP_QUALITY, method=6)
                return path
            return None
    except Exception as exc:
        print(f"Image optimize failed for {path}: {exc}", flush=True)
        return None


def _run_ocr(path):
    """Extract text from an image. Preprocesses (upscale → grayscale → autocontrast)
    so Tesseract handles subtitles, signage, and low-res screenshots reliably.
    Runs LSTM engine at two page-segmentation modes and keeps the richer result.
    """
    try:
        import pytesseract
        from PIL import Image, ImageOps

        img = Image.open(path)
        if img.mode != 'RGB':
            img = img.convert('RGB')

        # Upscale small images so small / video-overlay text hits Tesseract's sweet spot
        target_w = 2000
        if img.width < target_w:
            scale = target_w / img.width
            img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)

        gray = ImageOps.grayscale(img)
        enhanced = ImageOps.autocontrast(gray, cutoff=2)

        # PSM 3 = auto page segmentation; PSM 11 = sparse scattered text (signage, subtitles).
        # Run both, keep the richer result.
        results = []
        for psm in (3, 11):
            try:
                text = pytesseract.image_to_string(enhanced, config=f'--oem 1 --psm {psm}')
                text = re.sub(r'\s+', ' ', text).strip()
                results.append(text)
            except Exception:
                continue
        if not results:
            return ''
        return max(results, key=len)
    except Exception as exc:
        print(f'OCR failed on {path}: {exc}', flush=True)
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

    optimized_path = _optimize_image(path)
    if optimized_path:
        path = optimized_path
        filename = os.path.basename(path)
        ext = os.path.splitext(filename)[1].lower()

    # Upload to Supabase Storage
    if supabase:
        try:
            with open(path, 'rb') as f:
                supabase.storage.from_('uploads').upload(
                    path=filename,
                    file=f,
                    file_options={"content-type": f"image/{ext.lstrip('.')}"}
                )
        except Exception as exc:
            print(f"Supabase storage upload failed: {exc}", flush=True)

    ocr = _load(OCR_FILE, {})
    # Prefer OCR text extracted in the browser (Tesseract.js) since Render's
    # native Python runtime doesn't have the tesseract binary. Fall back to
    # server-side _run_ocr for local dev.
    client_ocr = (request.form.get('ocr_text') or '').strip()
    ocr[filename] = client_ocr or _run_ocr(path)
    _save(OCR_FILE, ocr)
    return jsonify({'filename': filename, 'url': f'/uploads/{filename}'}), 201


@app.route('/api/ocr/images', methods=['GET'])
@_studio_auth_required
def list_ocr_images():
    """List every uploaded image plus its current OCR status. The frontend
    uses this to drive a client-side rescan (OCR in the browser via
    Tesseract.js, result posted back via /api/ocr/save).
    """
    exts = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    filenames = set()

    if os.path.isdir(UPLOADS_DIR):
        for entry in os.scandir(UPLOADS_DIR):
            if entry.is_file() and os.path.splitext(entry.name)[1].lower() in exts:
                filenames.add(entry.name)

    if supabase:
        try:
            listed = supabase.storage.from_('uploads').list()
            for item in listed or []:
                name = item.get('name') if isinstance(item, dict) else None
                if name and os.path.splitext(name)[1].lower() in exts:
                    filenames.add(name)
        except Exception as exc:
            print(f'Supabase list failed: {exc}', flush=True)

    ocr = _load(OCR_FILE, {})
    items = [
        {'filename': name, 'has_text': bool((ocr.get(name) or '').strip())}
        for name in sorted(filenames)
    ]
    return jsonify({'images': items})


@app.route('/api/ocr/save', methods=['POST'])
@_studio_auth_required
def save_ocr():
    """Upsert a single OCR entry. Called by the frontend after running
    Tesseract.js against each image.
    """
    body = request.json or {}
    filename = (body.get('filename') or '').strip()
    text = (body.get('text') or '').strip()
    if not filename or '/' in filename or '\\' in filename:
        return jsonify({'error': 'bad filename'}), 400
    ocr = _load(OCR_FILE, {})
    ocr[filename] = text
    _save(OCR_FILE, ocr)
    return jsonify({'filename': filename, 'chars': len(text)})


def _rewrite_board_upload_refs(renames):
    """Rewrite `/uploads/X` references inside every board snapshot according
    to the `{old_name: new_name}` rename map. Also migrates OCR entries."""
    if not renames:
        return 0
    touched_boards = 0
    for board in _load_boards():
        board_id = board.get('id')
        if not board_id:
            continue
        data = _load(_board_file(board_id), {'snapshot': None})
        try:
            blob = json.dumps(data)
        except Exception:
            continue
        original = blob
        for old, new in renames.items():
            blob = blob.replace(f'/uploads/{old}', f'/uploads/{new}')
        if blob != original:
            try:
                _save(_board_file(board_id), json.loads(blob))
                touched_boards += 1
            except Exception as exc:
                print(f'board {board_id} rewrite failed: {exc}', flush=True)
    ocr = _load(OCR_FILE, {})
    ocr_dirty = False
    for old, new in renames.items():
        if old in ocr:
            ocr[new] = ocr.pop(old)
            ocr_dirty = True
    if ocr_dirty:
        _save(OCR_FILE, ocr)
    return touched_boards


@app.route('/api/images/optimize', methods=['POST'])
@_studio_auth_required
def optimize_existing_images():
    """Re-compress every image in the uploads bucket / dir with the same
    pipeline used on upload. Owner-only. Run once after deploying the
    optimizer to shrink images that were uploaded before compression was
    wired in. Opaque PNGs are converted to JPEG (huge size win) and board
    snapshots that reference them are rewritten in place."""
    exts = {'.jpg', '.jpeg', '.png', '.webp'}
    filenames = set()

    if os.path.isdir(UPLOADS_DIR):
        for entry in os.scandir(UPLOADS_DIR):
            if entry.is_file() and os.path.splitext(entry.name)[1].lower() in exts:
                filenames.add(entry.name)

    if supabase:
        try:
            listed = supabase.storage.from_('uploads').list()
            for item in listed or []:
                name = item.get('name') if isinstance(item, dict) else None
                if name and os.path.splitext(name)[1].lower() in exts:
                    filenames.add(name)
        except Exception as exc:
            print(f'Supabase list failed during image optimize: {exc}', flush=True)

    optimized = []
    skipped = []
    failed = []
    renames = {}

    for name in sorted(filenames):
        local_path = os.path.join(UPLOADS_DIR, name)
        if not os.path.exists(local_path) and supabase:
            try:
                blob = supabase.storage.from_('uploads').download(name)
                os.makedirs(UPLOADS_DIR, exist_ok=True)
                with open(local_path, 'wb') as f:
                    f.write(blob)
            except Exception as exc:
                print(f'Supabase download failed for {name}: {exc}', flush=True)
                failed.append(name)
                continue

        before = os.path.getsize(local_path)
        new_path = _optimize_image(local_path, allow_rename=True)
        if not new_path:
            skipped.append(name)
            continue

        new_name = os.path.basename(new_path)
        after = os.path.getsize(new_path)

        if supabase:
            new_ext = os.path.splitext(new_name)[1].lower().lstrip('.')
            content_type = f'image/{"jpeg" if new_ext == "jpg" else new_ext}'
            try:
                with open(new_path, 'rb') as f:
                    supabase.storage.from_('uploads').upload(
                        path=new_name,
                        file=f,
                        file_options={'content-type': content_type, 'upsert': 'true'},
                    )
            except Exception as exc:
                print(f'Supabase re-upload failed for {new_name}: {exc}', flush=True)
                failed.append(name)
                continue

            if new_name != name:
                try:
                    supabase.storage.from_('uploads').remove([name])
                except Exception as exc:
                    print(f'Supabase old-blob delete failed for {name}: {exc}', flush=True)

        with _signed_url_lock:
            _signed_url_cache.pop(name, None)
            _signed_url_cache.pop(new_name, None)

        if new_name != name:
            renames[name] = new_name
        optimized.append({'filename': name, 'new_filename': new_name, 'before': before, 'after': after})

    touched_boards = _rewrite_board_upload_refs(renames)

    total_before = sum(item['before'] for item in optimized)
    total_after = sum(item['after'] for item in optimized)

    return jsonify({
        'total_images': len(filenames),
        'optimized': len(optimized),
        'renamed': len(renames),
        'boards_rewritten': touched_boards,
        'skipped': len(skipped),
        'failed': len(failed),
        'bytes_before': total_before,
        'bytes_after': total_after,
        'bytes_saved': total_before - total_after,
        'samples': optimized[:10],
    })


# Cache Supabase signed URLs so we don't generate a fresh one on every image
# request. Boards often hold dozens of images; without caching, each refresh
# fans out N serial Supabase round-trips through the slow Render free tier
# backend. URLs are valid for SIGNED_URL_EXPIRY_SECONDS; we reuse them for
# SIGNED_URL_REUSE_SECONDS (shorter window leaves buffer before expiry).
SIGNED_URL_EXPIRY_SECONDS = 3600
SIGNED_URL_REUSE_SECONDS = 3000
_signed_url_cache = {}
_signed_url_lock = threading.Lock()


def _get_cached_signed_url(filename):
    now = time.time()
    with _signed_url_lock:
        entry = _signed_url_cache.get(filename)
        if entry and entry[1] > now:
            return entry[0]
    try:
        result = supabase.storage.from_('uploads').create_signed_url(filename, SIGNED_URL_EXPIRY_SECONDS)
    except Exception as exc:
        print(f"Supabase signed URL failed for {filename}: {exc}", flush=True)
        return None
    url = result.get('signedURL') if isinstance(result, dict) else None
    if not url:
        return None
    with _signed_url_lock:
        _signed_url_cache[filename] = (url, now + SIGNED_URL_REUSE_SECONDS)
    return url


_UPLOAD_REF_RE = re.compile(r'/uploads/([a-z0-9\-]+\.[a-z0-9]+)', flags=re.IGNORECASE)


def _extract_upload_filenames(snapshot):
    if not snapshot:
        return []
    try:
        blob = json.dumps(snapshot)
    except Exception:
        return []
    return list({m.group(1) for m in _UPLOAD_REF_RE.finditer(blob)})


def _asset_urls_for_snapshot(snapshot):
    """Return {filename: signed_url} for every /uploads/X referenced in the
    snapshot. Lets the frontend render images direct from Supabase instead of
    bouncing each request through Flask (one redirect per image adds up fast
    on Render free tier)."""
    if not supabase:
        return {}
    filenames = _extract_upload_filenames(snapshot)
    if not filenames:
        return {}
    urls = {}
    for name in filenames:
        url = _get_cached_signed_url(name)
        if url:
            urls[name] = url
    return urls


def _board_payload_with_assets(board_id):
    data = _load(_board_file(board_id), {'snapshot': None})
    data['asset_urls'] = _asset_urls_for_snapshot(data.get('snapshot'))
    return data


@app.route('/uploads/<filename>')
def serve_upload(filename):
    if not (_is_studio_authed() or _is_visitor_authed()):
        return jsonify({'error': 'Not authorized'}), 401

    if supabase:
        url = _get_cached_signed_url(filename)
        if url:
            resp = redirect(url)
            # Let the browser cache the 302 so subsequent loads skip the Flask
            # hop entirely. `private` keeps shared proxies out since the URL
            # is authenticated on our side.
            resp.headers['Cache-Control'] = f'private, max-age={SIGNED_URL_REUSE_SECONDS}'
            return resp

    response = send_from_directory(UPLOADS_DIR, filename)
    response.headers['Cache-Control'] = f'private, max-age={SIGNED_URL_REUSE_SECONDS}'
    return response


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


def _extract_rich_text(node):
    """Recursively pull text out of a tldraw/ProseMirror rich-text doc."""
    if not isinstance(node, dict):
        return ''
    parts = []
    if node.get('type') == 'text' and node.get('text'):
        parts.append(node['text'])
    for child in node.get('content') or []:
        extracted = _extract_rich_text(child)
        if extracted:
            parts.append(extracted)
    return ' '.join(parts)


def _text_from_tldraw(snapshot):
    out = []
    if not snapshot:
        return out
    store = snapshot.get('store') or {}
    assets = {
        record_id: record for record_id, record in store.items()
        if isinstance(record, dict) and record.get('typeName') == 'asset'
    }
    ocr = _load(OCR_FILE, {})
    for record in store.values():
        if not isinstance(record, dict) or record.get('typeName') != 'shape':
            continue
        shape_type = record.get('type')
        shape_id = record.get('id')
        props = record.get('props') or {}
        text = (
            _extract_rich_text(props.get('richText'))
            or props.get('text')
            or ''
        )
        if shape_type in ('note', 'text', 'geo', 'arrow') and text.strip():
            out.append({'kind': 'text', 'text': text.strip(), 'shape_id': shape_id})
        elif shape_type == 'frame':
            name = record.get('name') or props.get('name') or ''
            if name.strip():
                out.append({'kind': 'frame', 'text': name.strip(), 'shape_id': shape_id})
        elif shape_type in ('image', 'video'):
            alt_text = (record.get('meta') or {}).get('altText', '').strip()
            if alt_text:
                out.append({'kind': 'alt', 'text': alt_text, 'shape_id': shape_id})
            asset_id = props.get('assetId')
            asset = assets.get(asset_id) if asset_id else None
            src = ((asset or {}).get('props') or {}).get('src') or ''
            match = re.search(r'/uploads/([a-z0-9-]+\.[a-z]+)', src)
            if match:
                ocr_text = ocr.get(match.group(1), '')
                if ocr_text:
                    out.append({'kind': 'ocr', 'text': ocr_text, 'shape_id': shape_id})
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
        snap = data.get('snapshot') or {}
        extractor = _text_from_tldraw if snap.get('store') else _text_from_excalidraw
        for entry in extractor(snap):
            yield {
                'doc_type': 'board',
                'doc_id': board['id'],
                'doc_name': board['name'],
                'kind': entry['kind'],
                'text': entry['text'],
                'shape_id': entry.get('shape_id'),
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


_vectorizer = None
_corpus_texts = []
_corpus_vectors = None


def _rebuild_tfidf_index(items):
    """Rebuild TF-IDF index from current corpus."""
    global _vectorizer, _corpus_texts, _corpus_vectors
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
        
        _corpus_texts = [item['text'] for item in items]
        if not _corpus_texts:
            return
        
        _vectorizer = TfidfVectorizer(
            max_features=5000,
            stop_words='english',
            ngram_range=(1, 2),
            min_df=1,
        )
        _corpus_vectors = _vectorizer.fit_transform(_corpus_texts)
        print(f'TF-IDF index built: {len(_corpus_texts)} documents', flush=True)
    except Exception as exc:
        print(f'TF-IDF indexing failed: {exc}', flush=True)


def _tfidf_score(query, item_index):
    """Compute TF-IDF cosine similarity between query and indexed item."""
    global _vectorizer, _corpus_vectors
    try:
        from sklearn.metrics.pairwise import cosine_similarity
        if _vectorizer is None or _corpus_vectors is None:
            return 0.0
        query_vector = _vectorizer.transform([query])
        score = cosine_similarity(query_vector, _corpus_vectors[item_index])[0][0]
        return float(score)
    except Exception as exc:
        return 0.0


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

    # Rebuild TF-IDF index on each search (corpus changes frequently)
    _rebuild_tfidf_index(items)

    hits = []
    for idx, item in enumerate(items):
        keyword_score = _keyword(item['text'], query)
        tfidf_score = _tfidf_score(query, idx)
        
        # Combine keyword (exact match) and TF-IDF (semantic similarity)
        combined = keyword_score * 2.0 + tfidf_score * 3.0
        
        if keyword_score > 0 or tfidf_score > 0.1:
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
                    'alt': 'image alt text',
                    'sheet': 'spreadsheet cell',
                }.get(item['kind'], item['kind']),
                'score': combined,
                'shape_id': item.get('shape_id'),
            })
    hits.sort(key=lambda hit: hit['score'], reverse=True)
    return {'hits': hits[:50]}


@app.route('/api/search', methods=['POST'])
@_studio_auth_required
def search():
    return jsonify(_search_payload())


@app.route('/api/visitor/search', methods=['POST'])
@_viewer_auth_required
def visitor_search():
    folders = _get_workspace().get('folders', [])
    boards = [b for b in _load_boards() if _doc_is_visitor_visible(b, folders)]
    sheets = [s for s in _load_sheets() if _doc_is_visitor_visible(s, folders)]
    return jsonify(_search_payload(boards=boards, sheets=sheets))


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
    app.run(
        debug=False,
        port=int(os.getenv('PORT', '5001')),
        host='0.0.0.0',
        threaded=True,
    )
