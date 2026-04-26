"""Station 8 backend with studio auth and password-protected share links."""

import json
import os
import re
import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta as _timedelta
from functools import wraps

from flask import Flask, jsonify, request, send_from_directory, session, redirect
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

BOARDS_FILE = os.path.join(DATA_DIR, 'boards.json')
SHEETS_FILE = os.path.join(DATA_DIR, 'sheets.json')
GDOCS_FILE = os.path.join(DATA_DIR, 'gdocs.json')
GSHEETS_FILE = os.path.join(DATA_DIR, 'gsheets.json')
GOOGLE_AUTH_FILE = os.path.join(DATA_DIR, 'google_auth.json')
GDRIVE_CONTENTS_FILE = os.path.join(DATA_DIR, 'gdrive_contents.json')
OCR_FILE = os.path.join(DATA_DIR, 'ocr.json')
WORKSPACE_FILE = os.path.join(DATA_DIR, 'workspace.json')
SHARES_FILE = os.path.join(DATA_DIR, 'shares.json')
AUTH_FILE = os.path.join(DATA_DIR, 'auth.json')

SUPABASE_BUCKET = 'uploads'
SUPABASE_TABLE = 'json_storage'

# `/uploads/<filename>` references inside board snapshots, asset src URLs, etc.
# Capture group is the filename. Single source of truth — used by snapshot
# scanners, OCR text extraction, and the asset-rewrite migration helper.
_UPLOAD_REF_RE = re.compile(r'/uploads/([a-z0-9\-]+\.[a-z0-9]+)', flags=re.IGNORECASE)

PRODUCTION = bool(
    os.getenv('RENDER')
    or os.getenv('RENDER_EXTERNAL_URL')
    or os.getenv('RAILWAY_ENVIRONMENT')
    or os.getenv('COOKIE_SECURE', '').lower() in {'1', 'true', 'yes'}
)

ACCESS_OWNER = 'owner'
ACCESS_VISITOR = 'visitor'


def _env_flag(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


ALLOW_BROWSER_AUTH_SETUP = _env_flag('S8_ALLOW_PROD_AUTH_SETUP', default=not PRODUCTION)

app.secret_key = (
    os.getenv('FLASK_SECRET_KEY')
    or os.getenv('SECRET_KEY')
    or 'station8-dev-secret-change-me'
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
    if request.path.startswith('/api/auth/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    # `/uploads/*` serves image bytes to <img> tags. tldraw mounts image shapes
    # with crossOrigin="anonymous", so the browser makes a CORS request. If the
    # same image was previously loaded without crossorigin (no Origin header),
    # the cached response had no ACAO header — browsers then reuse that cached
    # entry for the CORS request and reject it. Always emit ACAO:* + Vary:Origin
    # here so every response (cached or fresh) satisfies CORS. No credentials
    # because <img crossorigin="anonymous"> doesn't send cookies anyway, and
    # ACAO:* is incompatible with Access-Control-Allow-Credentials.
    if request.path.startswith('/uploads/'):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Vary'] = 'Origin'
        return response
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
            response = supabase.table(SUPABASE_TABLE).select('data').eq('id', file_id).execute()
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
            supabase.table(SUPABASE_TABLE).upsert({
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


def _get_env_password(env_names, dev_default):
    for name in env_names:
        value = os.getenv(name)
        if value:
            return value
    return dev_default if not PRODUCTION else None


def _env_studio_password():
    return _get_env_password(
        ['OWNER_PASSWORD', 'STUDIO_PASSWORD', 'RESEARCH_OWNER_PASSWORD', 'RESEARCH_STUDIO_PASSWORD'],
        ACCESS_OWNER,
    )


def _env_visitor_password():
    return _get_env_password(
        ['VISITOR_PASSWORD', 'RESEARCH_VISITOR_PASSWORD'],
        ACCESS_VISITOR,
    )


def _load_auth_config():
    primary_auth = _load(AUTH_FILE, {})
    local_auth = _load_local_json(AUTH_FILE, {})

    auth = {}
    for candidate in (primary_auth, local_auth):
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


def _normalize_doc(item, folders):
    doc = dict(item or {})
    doc['folder_id'] = _normalize_folder_id(doc.get('folder_id'), folders)
    if 'tags' not in doc or not isinstance(doc.get('tags'), list):
        doc['tags'] = _parse_tags(doc.get('tags'))
    return doc


def _normalize_board(board, folders):
    doc = _normalize_doc(board, folders)
    # Strip any legacy theme field — Aurora is the only theme now
    doc.pop('theme', None)
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


def _normalize_gdrive_doc(doc, folders):
    """_normalize_doc + Drive-specific fields preserved."""
    item = _normalize_doc(doc, folders)
    item['drive_file_id'] = doc.get('drive_file_id') or None
    item['embed_url'] = doc.get('embed_url') or None
    return item


def _load_gdocs():
    folders = _get_workspace().get('folders', [])
    return [_normalize_gdrive_doc(d, folders) for d in _load(GDOCS_FILE, [])]


def _save_gdocs(gdocs):
    folders = _get_workspace().get('folders', [])
    _save(GDOCS_FILE, [_normalize_gdrive_doc(d, folders) for d in gdocs])


def _load_gsheets():
    folders = _get_workspace().get('folders', [])
    return [_normalize_gdrive_doc(d, folders) for d in _load(GSHEETS_FILE, [])]


def _save_gsheets(gsheets):
    folders = _get_workspace().get('folders', [])
    _save(GSHEETS_FILE, [_normalize_gdrive_doc(d, folders) for d in gsheets])


# ── Google Drive content sync (no-OAuth path) ────────────────────────────────
#
# Drive serves a public plaintext export of any file shared as "anyone with
# the link can view/edit" — no OAuth required:
#
#   docs:    https://docs.google.com/document/d/<id>/export?format=txt
#   sheets:  https://docs.google.com/spreadsheets/d/<id>/export?format=csv
#
# We snapshot that text into Supabase (`gdrive_contents.json`) and feed it
# into the existing TF-IDF search corpus alongside board / sheet text, so a
# search for content that lives inside a Google Doc actually matches.

import re as _re
import urllib.request as _urllib_request
import urllib.error as _urllib_error

_DRIVE_DOC_ID_RE = _re.compile(r'/document/d/([a-zA-Z0-9_-]+)')
_DRIVE_SHEET_ID_RE = _re.compile(r'/spreadsheets/d/([a-zA-Z0-9_-]+)')


def _extract_drive_file_id(url, kind):
    if not url:
        return None
    pattern = _DRIVE_DOC_ID_RE if kind == 'gdoc' else _DRIVE_SHEET_ID_RE
    match = pattern.search(url)
    return match.group(1) if match else None


def _fetch_gdrive_text(file_id, kind, timeout=15):
    """Fetch plaintext content of a Drive file. If the owner has connected
    their Google account, uses the Drive API with their access token (works
    for private files too). Otherwise falls back to the public export URL,
    which only works for "anyone with link" files. Returns text on success,
    None on failure."""
    if not file_id:
        return None

    access_token = _get_google_access_token()
    if access_token:
        mime = 'text/plain' if kind == 'gdoc' else 'text/csv' if kind == 'gsheet' else None
        if not mime:
            return None
        url = f'https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType={mime}'
        try:
            req = _urllib_request.Request(url, headers={
                'User-Agent': 'Station8/1.0',
                'Authorization': f'Bearer {access_token}',
            })
            with _urllib_request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    data = resp.read()
                    if data.startswith(b'\xef\xbb\xbf'):
                        data = data[3:]
                    text = data.decode('utf-8', errors='replace').strip()
                    return text or None
        except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError):
            pass  # Fall through to public export URL.

    if kind == 'gdoc':
        url = f'https://docs.google.com/document/d/{file_id}/export?format=txt'
    elif kind == 'gsheet':
        url = f'https://docs.google.com/spreadsheets/d/{file_id}/export?format=csv'
    else:
        return None
    try:
        req = _urllib_request.Request(url, headers={'User-Agent': 'Station8/1.0'})
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            data = resp.read()
            if data.startswith(b'\xef\xbb\xbf'):
                data = data[3:]
            text = data.decode('utf-8', errors='replace').strip()
            return text or None
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError):
        return None


def _load_gdrive_contents():
    contents = _load(GDRIVE_CONTENTS_FILE, {})
    return contents if isinstance(contents, dict) else {}


def _save_gdrive_contents(contents):
    _save(GDRIVE_CONTENTS_FILE, contents)


def _sync_one_gdrive_doc(item, kind, contents):
    """Pull text for a single doc/sheet and update `contents` in place. Returns
    True if content was refreshed, False if the fetch failed (existing cached
    content, if any, is preserved on failure)."""
    file_id = _extract_drive_file_id(item.get('embed_url'), kind)
    if not file_id:
        return False
    text = _fetch_gdrive_text(file_id, kind)
    if text is None:
        return False
    contents[f'{kind}-{item["id"]}'] = {
        'kind': kind,
        'doc_id': item['id'],
        'doc_name': item['name'],
        'text': text,
        'synced_at': datetime.now().isoformat(),
    }
    return True


def _list_docs_sorted(docs, *, visitor=False):
    """Common list-endpoint shape: visitor filter (when applicable) + sort by
    created_at desc. Keeps owner and visitor listings from drifting."""
    if visitor:
        folders = _get_workspace().get('folders', [])
        docs = [d for d in docs if _doc_is_visitor_visible(d, folders)]
    docs.sort(key=lambda item: item.get('created_at', ''), reverse=True)
    return docs


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


# Shared executor for parallelising Supabase reads on the visitor doc endpoints —
# each Supabase round-trip is ~200ms on Render free tier, so serialising the
# workspace + index + snapshot reads adds up to ~600ms; the futures fire all
# three concurrently for a single round-trip wall time instead.
_io_executor = ThreadPoolExecutor(max_workers=12, thread_name_prefix='io')


def _visitor_doc_load(doc_id, *, load_index, doc_file_fn, default_payload):
    """Visitor doc fetch: parallel reads of workspace + doc index + payload,
    then a visitor-visibility check. Returns (payload, error) where exactly
    one of the two is None. Caller jsonifies the payload or returns the error.
    """
    workspace_future = _io_executor.submit(_get_workspace)
    docs_future = _io_executor.submit(load_index)
    payload_future = _io_executor.submit(_load, doc_file_fn(doc_id), default_payload)

    folders = workspace_future.result().get('folders', [])
    doc = next((d for d in docs_future.result() if d['id'] == doc_id), None)
    if not doc or not _doc_is_visitor_visible(doc, folders):
        return None, (jsonify({'error': 'Not found'}), 404)
    return payload_future.result(), None


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
        return ACCESS_OWNER
    if _is_visitor_authed():
        return ACCESS_VISITOR
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
    """Extract /uploads/<filename> references from a tldraw board snapshot."""
    names = set()
    if not snapshot:
        return names
    try:
        blob = json.dumps(snapshot)
        for m in _UPLOAD_REF_RE.finditer(blob):
            names.add(m.group(1))
    except Exception:
        pass
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
    return jsonify({'authenticated': True, 'requires_setup': False, 'access': ACCESS_OWNER})


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
        return jsonify({'authenticated': True, 'access': ACCESS_OWNER})
    if not _verify_visitor_password(password):
        return jsonify({'error': 'Wrong password'}), 401
    session['visitor_authed'] = True
    session.pop('studio_authed', None)
    session.modified = True
    return jsonify({'authenticated': True, 'access': ACCESS_VISITOR})


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
    return jsonify(_list_docs_sorted(_load_boards()))


@app.route('/api/visitor/boards', methods=['GET'])
@_viewer_auth_required
def list_visitor_boards():
    return jsonify(_list_docs_sorted(_load_boards(), visitor=True))


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
        if 'private' in data:
            board['private'] = True if data['private'] is True else (False if data['private'] is False else None)
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
    data, error = _visitor_doc_load(
        board_id, load_index=_load_boards, doc_file_fn=_board_file, default_payload={'snapshot': None}
    )
    if error:
        return error
    data['asset_urls'] = _asset_urls_for_snapshot(data.get('snapshot'))
    return jsonify(data)


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
    return jsonify(_list_docs_sorted(_load_sheets()))


@app.route('/api/visitor/sheets', methods=['GET'])
@_viewer_auth_required
def list_visitor_sheets():
    return jsonify(_list_docs_sorted(_load_sheets(), visitor=True))


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
    data, error = _visitor_doc_load(
        sheet_id, load_index=_load_sheets, doc_file_fn=_sheet_file, default_payload={'data': []}
    )
    if error:
        return error
    return jsonify(data)


@app.route('/api/sheets/<sheet_id>', methods=['PUT'])
@_studio_auth_required
def update_sheet(sheet_id):
    data = request.json or {}
    _save(_sheet_file(sheet_id), {'data': data.get('data') or []})
    return '', 204


# ── Google Drive integration (gdocs + gsheets) ───────────────────────────────
#
# Real OAuth 2.0 flow. The owner clicks "Connect Google", browser redirects
# to Google's auth screen, Google redirects back to /api/google/callback with
# an auth code, we exchange that for access + refresh tokens and store them
# in `data/google_auth.json`. Subsequent Drive API calls use the access token;
# `_get_google_access_token` refreshes it transparently when it expires.

import urllib.parse as _urllib_parse

_GOOGLE_OAUTH_SCOPES = ' '.join([
    # Read content (for the search index) AND write permissions (so the
    # "Share all to visitors" button can flip docs to anyone-with-link).
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid',
])


def _google_oauth_creds():
    """Return (client_id, client_secret, redirect_uri) or None if unconfigured."""
    # .strip() guards against trailing whitespace/newlines that the Render
    # dashboard's value editor can silently paste — a single `\n` on
    # GOOGLE_OAUTH_REDIRECT_URI breaks byte-exact matching against the
    # authorized URI in Google Cloud and yields a generic invalid_request.
    cid = (os.getenv('GOOGLE_CLIENT_ID') or '').strip()
    secret = (os.getenv('GOOGLE_CLIENT_SECRET') or '').strip()
    redirect = (os.getenv('GOOGLE_OAUTH_REDIRECT_URI') or '').strip() or 'http://127.0.0.1:5001/api/google/callback'
    if not cid or not secret:
        return None
    return cid, secret, redirect


def _frontend_origin():
    """Where to redirect the browser after OAuth completes."""
    explicit = os.getenv('FRONTEND_URL')
    if explicit:
        return explicit.rstrip('/')
    return 'https://YOUR_DOMAIN' if PRODUCTION else 'http://127.0.0.1:5173'


def _google_auth_state():
    state = _load(GOOGLE_AUTH_FILE, {}) or {}
    return {
        'connected': bool(state.get('connected')),
        'email': state.get('email') or None,
    }


def _load_google_token_record():
    return _load(GOOGLE_AUTH_FILE, {}) or {}


def _save_google_token_record(record):
    _save(GOOGLE_AUTH_FILE, record)


def _google_token_expired(record):
    expires_at = record.get('token_expires_at')
    if not expires_at:
        return True
    try:
        deadline = datetime.fromisoformat(expires_at)
    except ValueError:
        return True
    # Refresh 60 seconds before actual expiry to avoid edge cases.
    return (deadline - datetime.now()).total_seconds() < 60


def _refresh_google_access_token(record):
    """Use the refresh token to mint a new access token. Returns the updated
    record on success, None on failure."""
    creds = _google_oauth_creds()
    if not creds or not record.get('refresh_token'):
        return None
    cid, secret, _ = creds
    body = _urllib_parse.urlencode({
        'client_id': cid,
        'client_secret': secret,
        'refresh_token': record['refresh_token'],
        'grant_type': 'refresh_token',
    }).encode('utf-8')
    try:
        req = _urllib_request.Request(
            'https://oauth2.googleapis.com/token',
            data=body,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with _urllib_request.urlopen(req, timeout=15) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Google token refresh failed: {exc}', flush=True)
        return None
    record['access_token'] = payload['access_token']
    expires_in = int(payload.get('expires_in', 3600))
    record['token_expires_at'] = (datetime.now() + _timedelta(seconds=expires_in)).isoformat()
    _save_google_token_record(record)
    return record


def _get_google_access_token():
    """Return a valid access token, refreshing if needed. None if disconnected."""
    record = _load_google_token_record()
    if not record.get('connected') or not record.get('access_token'):
        return None
    if _google_token_expired(record):
        record = _refresh_google_access_token(record)
        if not record:
            return None
    return record.get('access_token')


@app.route('/api/google/status', methods=['GET'])
@_studio_auth_required
def google_status():
    # Owner-only — visitors must not learn the connected email or even whether
    # Google is wired up. Their view goes through the cached gdrive_contents
    # blob; nothing about the owner's auth leaks into the visitor surface.
    return jsonify(_google_auth_state())


@app.route('/api/google/auth', methods=['GET'])
@_studio_auth_required
def google_auth_start():
    """Kick off the OAuth flow: redirect browser to Google's consent screen."""
    creds = _google_oauth_creds()
    if not creds:
        return jsonify({'error': 'Google OAuth not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)'}), 500
    cid, _, redirect_uri = creds
    state = secrets.token_urlsafe(32)
    session['google_oauth_state'] = state
    params = _urllib_parse.urlencode({
        'client_id': cid,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': _GOOGLE_OAUTH_SCOPES,
        'access_type': 'offline',
        'prompt': 'consent',  # force refresh_token issuance even on re-auth
        'state': state,
    }, safe=':/', quote_via=_urllib_parse.quote)
    return redirect(f'https://accounts.google.com/o/oauth2/v2/auth?{params}')


@app.route('/api/google/callback', methods=['GET'])
def google_oauth_callback():
    """Google redirects here after the user approves. Exchange code for tokens."""
    creds = _google_oauth_creds()
    if not creds:
        return 'Google OAuth not configured', 500
    cid, secret, redirect_uri = creds

    error = request.args.get('error')
    if error:
        return redirect(f'{_frontend_origin()}/?google=error&reason={_urllib_parse.quote(error)}')

    code = request.args.get('code')
    state = request.args.get('state')
    expected_state = session.pop('google_oauth_state', None)
    if not code or not state or state != expected_state:
        return redirect(f'{_frontend_origin()}/?google=error&reason=state_mismatch')

    body = _urllib_parse.urlencode({
        'client_id': cid,
        'client_secret': secret,
        'code': code,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    }).encode('utf-8')
    try:
        req = _urllib_request.Request(
            'https://oauth2.googleapis.com/token',
            data=body,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with _urllib_request.urlopen(req, timeout=15) as resp:
            token_payload = json.loads(resp.read().decode('utf-8'))
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Google token exchange failed: {exc}', flush=True)
        return redirect(f'{_frontend_origin()}/?google=error&reason=token_exchange')

    access_token = token_payload.get('access_token')
    refresh_token = token_payload.get('refresh_token')
    expires_in = int(token_payload.get('expires_in', 3600))
    if not access_token:
        return redirect(f'{_frontend_origin()}/?google=error&reason=no_access_token')

    email = None
    try:
        req = _urllib_request.Request(
            'https://www.googleapis.com/oauth2/v2/userinfo',
            headers={'Authorization': f'Bearer {access_token}'},
        )
        with _urllib_request.urlopen(req, timeout=15) as resp:
            email = json.loads(resp.read().decode('utf-8')).get('email')
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError):
        pass

    record = {
        'connected': True,
        'email': email,
        'access_token': access_token,
        'token_expires_at': (datetime.now() + _timedelta(seconds=expires_in)).isoformat(),
        'connected_at': datetime.now().isoformat(),
    }
    if refresh_token:
        record['refresh_token'] = refresh_token
    else:
        # Re-auth without prompt=consent omits refresh_token; preserve the old one.
        prior = _load_google_token_record()
        if prior.get('refresh_token'):
            record['refresh_token'] = prior['refresh_token']
    _save_google_token_record(record)

    return redirect(f'{_frontend_origin()}/?google=connected')


@app.route('/api/google/disconnect', methods=['POST'])
@_studio_auth_required
def google_disconnect():
    _save(GOOGLE_AUTH_FILE, {'connected': False, 'email': None})
    return jsonify(_google_auth_state())


def _delete_drive_file(file_id, timeout=15):
    """Permanently delete the underlying file in Drive. Used when the user
    opts in to "delete from Drive too" in the Station 8 delete dialog.
    Returns True on success (200/204), False on any failure."""
    if not file_id:
        return False
    access_token = _get_google_access_token()
    if not access_token:
        return False
    url = f'https://www.googleapis.com/drive/v3/files/{file_id}'
    try:
        req = _urllib_request.Request(url, method='DELETE', headers={
            'Authorization': f'Bearer {access_token}',
        })
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 204)
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Drive file delete failed for {file_id}: {exc}', flush=True)
        return False


def _share_drive_file_publicly(file_id, timeout=15):
    """Add an `anyone with link → reader` permission so visitors can view the
    embedded iframe without being signed into Google. Idempotent: if the
    permission already exists, Google returns 200 with the existing record.
    Returns True on success, False on any failure."""
    if not file_id:
        return False
    access_token = _get_google_access_token()
    if not access_token:
        return False
    body = json.dumps({'role': 'reader', 'type': 'anyone'}).encode('utf-8')
    url = f'https://www.googleapis.com/drive/v3/files/{file_id}/permissions'
    try:
        req = _urllib_request.Request(url, data=body, method='POST', headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        })
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 204)
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Drive permissions update failed for {file_id}: {exc}', flush=True)
        return False


@app.route('/api/google/share-all', methods=['POST'])
@_studio_auth_required
def google_share_all():
    """Set every linked gdoc/gsheet to `anyone with link → reader`. Run after
    adding new docs so visitors can actually view the embed (the search index
    works without sharing, but the iframe needs the visitor's browser to be
    able to load the doc directly from Google)."""
    if not _get_google_access_token():
        return jsonify({'error': 'Google not connected'}), 400
    items = (
        [(item, 'gdoc') for item in _load_gdocs()]
        + [(item, 'gsheet') for item in _load_gsheets()]
    )
    shared = 0
    failed = 0
    for item, kind in items:
        file_id = _extract_drive_file_id(item.get('embed_url'), kind)
        if not file_id:
            continue
        if _share_drive_file_publicly(file_id):
            shared += 1
        else:
            failed += 1
    return jsonify({'shared': shared, 'failed': failed, 'total': len(items)})


def _maybe_sync_one(item, kind):
    """Best-effort single-item sync — used after create/patch so newly-linked
    content lands in search without the user having to hit the sync button.
    Swallows errors so a Drive flake never breaks doc creation."""
    try:
        contents = _load_gdrive_contents()
        if _sync_one_gdrive_doc(item, kind, contents):
            _save_gdrive_contents(contents)
    except Exception:
        pass


def _drop_gdrive_content(kind, item_id):
    """Drop any cached content for a deleted gdoc/gsheet so search doesn't
    surface ghost hits. Safe to call even if no cache entry exists."""
    try:
        contents = _load_gdrive_contents()
        key = f'{kind}-{item_id}'
        if key in contents:
            del contents[key]
            _save_gdrive_contents(contents)
    except Exception:
        pass


def _sync_missing_only():
    """Backfill the cache for any gdoc/gsheet that has no entry yet. Runs
    ahead of every search so the first search after fixing a doc's sharing
    settings (or after a flaky network during create-time sync) picks up
    the content automatically — no manual Sync button required.

    Already-cached items are left alone; stale-cache refresh stays on the
    explicit Sync button to avoid hammering Google on every keystroke."""
    try:
        contents = _load_gdrive_contents()
        changed = False
        for item in _load_gdocs():
            if not (contents.get(f'gdoc-{item["id"]}') or {}).get('text'):
                if _sync_one_gdrive_doc(item, 'gdoc', contents):
                    changed = True
        for item in _load_gsheets():
            if not (contents.get(f'gsheet-{item["id"]}') or {}).get('text'):
                if _sync_one_gdrive_doc(item, 'gsheet', contents):
                    changed = True
        if changed:
            _save_gdrive_contents(contents)
    except Exception:
        pass


_DRIVE_MIME = {
    'gdoc': 'application/vnd.google-apps.document',
    'gsheet': 'application/vnd.google-apps.spreadsheet',
}
_DRIVE_EDIT_URL = {
    'gdoc': 'https://docs.google.com/document/d/{id}/edit',
    'gsheet': 'https://docs.google.com/spreadsheets/d/{id}/edit',
}


def _create_drive_file(kind, name, timeout=15):
    """Create a fresh Google Doc or Sheet in the connected user's Drive.
    Returns (file_id, embed_url) on success, (None, None) if not connected
    or the API call fails."""
    access_token = _get_google_access_token()
    if not access_token or kind not in _DRIVE_MIME:
        return None, None
    body = json.dumps({'name': name, 'mimeType': _DRIVE_MIME[kind]}).encode('utf-8')
    try:
        req = _urllib_request.Request(
            'https://www.googleapis.com/drive/v3/files',
            data=body, method='POST',
            headers={'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'},
        )
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Drive file create failed: {exc}', flush=True)
        return None, None
    file_id = payload.get('id')
    if not file_id:
        return None, None
    return file_id, _DRIVE_EDIT_URL[kind].format(id=file_id)


def _create_gdrive_doc(load_fn, save_fn, request_data, kind):
    name = (request_data.get('name') or 'Untitled').strip() or 'Untitled'
    folders = _get_workspace().get('folders', [])
    pasted_url = (request_data.get('embed_url') or '').strip() or None

    drive_file_id = (request_data.get('drive_file_id') or '').strip() or None
    embed_url = pasted_url

    # No URL pasted → create the file in Drive automatically (when connected)
    # and share it publicly so visitors can view the embed without a manual
    # share-all run.
    if not embed_url and _get_google_access_token():
        new_id, new_url = _create_drive_file(kind, name)
        if new_id and new_url:
            drive_file_id = new_id
            embed_url = new_url
            _share_drive_file_publicly(new_id)

    item = {
        'id': str(uuid.uuid4())[:8],
        'name': name,
        'tags': _parse_tags(request_data.get('tags')),
        'folder_id': _normalize_folder_id(request_data.get('folder_id'), folders),
        'created_at': datetime.now().isoformat(),
        'drive_file_id': drive_file_id,
        'embed_url': embed_url,
    }
    items = load_fn()
    items.append(item)
    save_fn(items)
    return item


def _patch_gdrive_doc(load_fn, save_fn, item_id, data):
    items = load_fn()
    folders = _get_workspace().get('folders', [])
    for item in items:
        if item['id'] != item_id:
            continue
        if 'name' in data:
            item['name'] = (data['name'] or '').strip() or item.get('name', 'Untitled')
        if 'tags' in data:
            item['tags'] = _parse_tags(data['tags'])
        if 'folder_id' in data:
            item['folder_id'] = _normalize_folder_id(data.get('folder_id'), folders)
        if 'private' in data:
            item['private'] = True if data['private'] is True else (False if data['private'] is False else None)
        if 'embed_url' in data:
            item['embed_url'] = (data.get('embed_url') or '').strip() or None
        if 'drive_file_id' in data:
            item['drive_file_id'] = (data.get('drive_file_id') or '').strip() or None
        save_fn(items)
        return item
    return None


@app.route('/api/gdocs', methods=['GET'])
@_studio_auth_required
def list_gdocs():
    return jsonify(_list_docs_sorted(_load_gdocs()))


@app.route('/api/visitor/gdocs', methods=['GET'])
@_viewer_auth_required
def list_visitor_gdocs():
    return jsonify(_list_docs_sorted(_load_gdocs(), visitor=True))


@app.route('/api/gdocs', methods=['POST'])
@_studio_auth_required
def create_gdoc():
    item = _create_gdrive_doc(_load_gdocs, _save_gdocs, request.json or {}, 'gdoc')
    _maybe_sync_one(item, 'gdoc')
    return jsonify(item), 201


@app.route('/api/gdocs/<gdoc_id>', methods=['PATCH'])
@_studio_auth_required
def patch_gdoc(gdoc_id):
    body = request.json or {}
    item = _patch_gdrive_doc(_load_gdocs, _save_gdocs, gdoc_id, body)
    if item is None:
        return jsonify({'error': 'Not found'}), 404
    if 'embed_url' in body:
        _maybe_sync_one(item, 'gdoc')
    return jsonify(item)


@app.route('/api/gdocs/<gdoc_id>', methods=['DELETE'])
@_studio_auth_required
def delete_gdoc(gdoc_id):
    if request.args.get('drive') in ('1', 'true'):
        for d in _load_gdocs():
            if d['id'] == gdoc_id:
                file_id = _extract_drive_file_id(d.get('embed_url'), 'gdoc')
                if file_id:
                    _delete_drive_file(file_id)
                break
    items = [d for d in _load_gdocs() if d['id'] != gdoc_id]
    _save_gdocs(items)
    _drop_gdrive_content('gdoc', gdoc_id)
    return '', 204


@app.route('/api/gdocs/<gdoc_id>', methods=['GET'])
@_studio_auth_required
def get_gdoc(gdoc_id):
    for d in _load_gdocs():
        if d['id'] == gdoc_id:
            return jsonify(d)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/visitor/gdocs/<gdoc_id>', methods=['GET'])
@_viewer_auth_required
def get_visitor_gdoc(gdoc_id):
    folders = _get_workspace().get('folders', [])
    for d in _load_gdocs():
        if d['id'] == gdoc_id and _doc_is_visitor_visible(d, folders):
            return jsonify(d)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/gsheets', methods=['GET'])
@_studio_auth_required
def list_gsheets():
    return jsonify(_list_docs_sorted(_load_gsheets()))


@app.route('/api/visitor/gsheets', methods=['GET'])
@_viewer_auth_required
def list_visitor_gsheets():
    return jsonify(_list_docs_sorted(_load_gsheets(), visitor=True))


@app.route('/api/gsheets', methods=['POST'])
@_studio_auth_required
def create_gsheet():
    item = _create_gdrive_doc(_load_gsheets, _save_gsheets, request.json or {}, 'gsheet')
    _maybe_sync_one(item, 'gsheet')
    return jsonify(item), 201


@app.route('/api/gsheets/<gsheet_id>', methods=['PATCH'])
@_studio_auth_required
def patch_gsheet(gsheet_id):
    body = request.json or {}
    item = _patch_gdrive_doc(_load_gsheets, _save_gsheets, gsheet_id, body)
    if item is None:
        return jsonify({'error': 'Not found'}), 404
    if 'embed_url' in body:
        _maybe_sync_one(item, 'gsheet')
    return jsonify(item)


@app.route('/api/gsheets/<gsheet_id>', methods=['DELETE'])
@_studio_auth_required
def delete_gsheet(gsheet_id):
    if request.args.get('drive') in ('1', 'true'):
        for d in _load_gsheets():
            if d['id'] == gsheet_id:
                file_id = _extract_drive_file_id(d.get('embed_url'), 'gsheet')
                if file_id:
                    _delete_drive_file(file_id)
                break
    items = [d for d in _load_gsheets() if d['id'] != gsheet_id]
    _save_gsheets(items)
    _drop_gdrive_content('gsheet', gsheet_id)
    return '', 204


@app.route('/api/gsheets/<gsheet_id>', methods=['GET'])
@_studio_auth_required
def get_gsheet(gsheet_id):
    for d in _load_gsheets():
        if d['id'] == gsheet_id:
            return jsonify(d)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/visitor/gsheets/<gsheet_id>', methods=['GET'])
@_viewer_auth_required
def get_visitor_gsheet(gsheet_id):
    folders = _get_workspace().get('folders', [])
    for d in _load_gsheets():
        if d['id'] == gsheet_id and _doc_is_visitor_visible(d, folders):
            return jsonify(d)
    return jsonify({'error': 'Not found'}), 404


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
                supabase.storage.from_(SUPABASE_BUCKET).upload(
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
    filenames = _collect_upload_filenames({'.jpg', '.jpeg', '.png', '.gif', '.webp'})
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
    filenames = _collect_upload_filenames({'.jpg', '.jpeg', '.png', '.webp'})

    optimized = []
    skipped = []
    failed = []
    renames = {}

    for name in sorted(filenames):
        local_path = os.path.join(UPLOADS_DIR, name)
        if not os.path.exists(local_path) and supabase:
            try:
                blob = supabase.storage.from_(SUPABASE_BUCKET).download(name)
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
                    supabase.storage.from_(SUPABASE_BUCKET).upload(
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
                    supabase.storage.from_(SUPABASE_BUCKET).remove([name])
                except Exception as exc:
                    print(f'Supabase old-blob delete failed for {name}: {exc}', flush=True)

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


# Uploads bucket is public — image URLs are deterministic and never expire, so
# we build them locally instead of round-tripping to Supabase to sign. Each
# URL points straight at the Supabase CDN; the browser caches them indefinitely
# (see Cache-Control on serve_upload), removing Render from the hot path after
# the first redirect.
UPLOAD_CACHE_MAX_AGE = 31536000  # 1 year


def _public_upload_url(filename):
    if not supabase:
        return None
    try:
        url = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(filename)
    except Exception as exc:
        print(f"Supabase public URL build failed for {filename}: {exc}", flush=True)
        return None
    # storage3 sometimes appends a trailing '?' — strip it so the URL matches
    # exactly what the CDN serves and stays cache-key-stable in the browser.
    return url.rstrip('?') if url else None


def _extract_upload_filenames(snapshot):
    if not snapshot:
        return []
    try:
        blob = json.dumps(snapshot)
    except Exception:
        return []
    return list({m.group(1) for m in _UPLOAD_REF_RE.finditer(blob)})


def _asset_urls_for_snapshot(snapshot):
    """Return {filename: public_url} for every /uploads/X referenced in the
    snapshot. Public URLs are deterministic string-builds (no Supabase round
    trips, no expiry), so the frontend's assetStore resolver can serve images
    straight from the Supabase CDN without bouncing through Render."""
    if not supabase:
        return {}
    filenames = _extract_upload_filenames(snapshot)
    urls = {}
    for name in filenames:
        url = _public_upload_url(name)
        if url:
            urls[name] = url
    return urls


def _collect_upload_filenames(exts):
    """Union of upload filenames in the local cache + Supabase bucket, filtered
    to the given extension set (lowercased, dotted: {'.jpg', '.png', ...})."""
    filenames = set()
    if os.path.isdir(UPLOADS_DIR):
        for entry in os.scandir(UPLOADS_DIR):
            if entry.is_file() and os.path.splitext(entry.name)[1].lower() in exts:
                filenames.add(entry.name)
    if supabase:
        try:
            for item in supabase.storage.from_(SUPABASE_BUCKET).list() or []:
                name = item.get('name') if isinstance(item, dict) else None
                if name and os.path.splitext(name)[1].lower() in exts:
                    filenames.add(name)
        except Exception as exc:
            print(f'Supabase list failed: {exc}', flush=True)
    return filenames


def _board_payload_with_assets(board_id):
    data = _load(_board_file(board_id), {'snapshot': None})
    data['asset_urls'] = _asset_urls_for_snapshot(data.get('snapshot'))
    return data


@app.route('/uploads/<filename>')
def serve_upload(filename):
    # No session auth — hit by <img> tags which can't send cookies cross-origin.
    # The uploads bucket is public, so we 302 to the Supabase CDN URL and let
    # the browser fetch bytes directly. The redirect is marked immutable with a
    # 1-year max-age, so after the first hit per image the browser never asks
    # us again. For boards loaded via /api/boards, the frontend already has the
    # public URLs in asset_urls and skips this endpoint entirely.
    if supabase:
        url = _public_upload_url(filename)
        if url:
            resp = redirect(url, code=302)
            resp.headers['Cache-Control'] = f'public, max-age={UPLOAD_CACHE_MAX_AGE}, immutable'
            return resp

    response = send_from_directory(UPLOADS_DIR, filename)
    response.headers['Cache-Control'] = f'public, max-age={UPLOAD_CACHE_MAX_AGE}, immutable'
    return response


# ── Search ───────────────────────────────────────────────────────────────────

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
            match = _UPLOAD_REF_RE.search(src)
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


def _all_items(boards=None, sheets=None, gdocs=None, gsheets=None):
    board_items = boards if boards is not None else _load_boards()
    sheet_items = sheets if sheets is not None else _load_sheets()
    gdoc_items = gdocs if gdocs is not None else _load_gdocs()
    gsheet_items = gsheets if gsheets is not None else _load_gsheets()
    drive_contents = _load_gdrive_contents()

    # Index every doc's name + tags so searches like "test" surface docs whose
    # title or tag contains the term, even when the body never mentions it.
    for doc_type, items in (
        ('board', board_items), ('sheet', sheet_items),
        ('gdoc', gdoc_items),   ('gsheet', gsheet_items),
    ):
        for item in items:
            name = (item.get('name') or '').strip()
            if name:
                yield {
                    'doc_type': doc_type, 'doc_id': item['id'], 'doc_name': name,
                    'kind': 'name', 'text': name,
                }
            for tag in item.get('tags') or []:
                tag = (tag or '').strip()
                if tag:
                    yield {
                        'doc_type': doc_type, 'doc_id': item['id'], 'doc_name': name,
                        'kind': 'tag', 'text': tag,
                    }

    for board in board_items:
        data = _load(_board_file(board['id']), {'snapshot': None})
        snap = data.get('snapshot') or {}
        for entry in _text_from_tldraw(snap):
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
    for gdoc in gdoc_items:
        cached = drive_contents.get(f'gdoc-{gdoc["id"]}') or {}
        text = (cached.get('text') or '').strip()
        if not text:
            continue
        yield {
            'doc_type': 'gdoc',
            'doc_id': gdoc['id'],
            'doc_name': gdoc['name'],
            'kind': 'gdoc',
            'text': text,
        }
    for gsheet in gsheet_items:
        cached = drive_contents.get(f'gsheet-{gsheet["id"]}') or {}
        raw = (cached.get('text') or '').strip()
        if not raw:
            continue
        import csv as _csv, io as _io
        try:
            cells = [c.strip() for row in _csv.reader(_io.StringIO(raw)) for c in row if c.strip()]
        except Exception:
            cells = [raw]
        for cell in cells:
            yield {
                'doc_type': 'gsheet',
                'doc_id': gsheet['id'],
                'doc_name': gsheet['name'],
                'kind': 'gsheet',
                'text': cell,
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


def _search_payload(boards=None, sheets=None, gdocs=None, gsheets=None):
    body = request.json or {}
    query = (body.get('query') or '').strip()
    if not query:
        return {'hits': []}

    items = list(_all_items(boards=boards, sheets=sheets, gdocs=gdocs, gsheets=gsheets))
    if not items:
        return {'hits': []}

    # Rebuild TF-IDF index on each search (corpus changes frequently)
    _rebuild_tfidf_index(items)

    def _snippet(text, q, max_len=200):
        pos = text.lower().find(q.lower())
        if pos < 0:
            return text[:max_len]
        start = max(0, pos - 60)
        end = min(len(text), pos + len(q) + 140)
        chunk = text[start:end]
        return ('…' if start > 0 else '') + chunk + ('…' if end < len(text) else '')

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
                'snippet': _snippet(item['text'], query),
                'source': {
                    'text': 'text',
                    'frame': 'section',
                    'ocr': 'OCR from image',
                    'alt': 'image alt text',
                    'sheet': 'spreadsheet cell',
                    'gdoc': 'Doc',
                    'gsheet': 'Sheet',
                }.get(item['kind'], item['kind']),
                'score': combined,
                'shape_id': item.get('shape_id'),
            })
    hits.sort(key=lambda hit: hit['score'], reverse=True)
    return {'hits': hits[:50]}


@app.route('/api/search', methods=['POST'])
@_studio_auth_required
def search():
    _sync_missing_only()
    return jsonify(_search_payload())


@app.route('/api/visitor/search', methods=['POST'])
@_viewer_auth_required
def visitor_search():
    _sync_missing_only()
    folders = _get_workspace().get('folders', [])
    boards = [b for b in _load_boards() if _doc_is_visitor_visible(b, folders)]
    sheets = [s for s in _load_sheets() if _doc_is_visitor_visible(s, folders)]
    gdocs = [d for d in _load_gdocs() if _doc_is_visitor_visible(d, folders)]
    gsheets = [d for d in _load_gsheets() if _doc_is_visitor_visible(d, folders)]
    return jsonify(_search_payload(boards=boards, sheets=sheets, gdocs=gdocs, gsheets=gsheets))


@app.route('/api/share/<token>/search', methods=['POST'])
def share_search(token):
    share, error = _active_share_or_401(token)
    if error:
        return error
    payload = _scoped_share_payload(share)
    return jsonify(_search_payload(boards=payload['boards'], sheets=payload['sheets']))


@app.route('/')
def root():
    return 'Station 8 backend.', 200


if __name__ == '__main__':
    _is_dev = not PRODUCTION
    app.run(
        debug=_is_dev,
        use_reloader=_is_dev,
        port=int(os.getenv('PORT', '5001')),
        host='0.0.0.0',
        threaded=True,
    )
