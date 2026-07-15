"""Station 8 backend with studio auth and password-protected share links."""

import base64
import hashlib
import json
import os
import re
import secrets
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta as _timedelta, timezone as _timezone
from functools import wraps
from html.parser import HTMLParser as _StdlibHTMLParser
from threading import RLock

from flask import Flask, jsonify, request, send_from_directory, session, redirect
from cryptography.fernet import Fernet, InvalidToken
from itsdangerous import URLSafeSerializer, BadSignature
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
ACCESS_PROFILES_FILE = os.path.join(DATA_DIR, 'access_profiles.json')
AUTH_FILE = os.path.join(DATA_DIR, 'auth.json')
REPORTS_FILE = os.path.join(DATA_DIR, 'reports.json')
R_TOKENS_FILE = os.path.join(DATA_DIR, 'r_tokens.json')
PDFS_FILE = os.path.join(DATA_DIR, 'pdfs.json')
PDFS_DIR = os.path.join(STORAGE_ROOT, 'pdfs')

SUPABASE_BUCKET = 'uploads'
PDF_BUCKET = 'pdfs'
SUPABASE_TABLE = 'json_storage'
PDF_BUCKET_MIME_TYPES = ('application/pdf',)

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

MAX_REPORT_HTML_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PDF_COMPLETION_BYTES = 12 * 1024 * 1024
MAX_PDF_TEXT_CHARS = 2_000_000
MAX_PDF_PAGE_TEXT_CHARS = 100_000
MAX_PDF_PAGES = 1_000
MAX_PENDING_PDF_UPLOADS = 8
MAX_PDF_PRUNE_SCAN = 500
MAX_PDF_PRUNE_DELETE = 50
PDF_UPLOAD_TICKET_TTL_SECONDS = 2 * 60 * 60
PDF_READ_URL_TTL_SECONDS = 60 * 60
PDF_BUCKET_CONFIG_TTL_SECONDS = 5 * 60
PDF_UPLOAD_TICKETS_SESSION_KEY = 'pdf_upload_tickets'
PDF_TEXT_STATUSES = frozenset({'indexed', 'truncated', 'no_text'})
PDF_TEXT_INDEX_VERSION = 2
PDF_LEGACY_TEXT_INDEX_VERSION = 1
PDF_SERVICE_ROLE_ERROR = (
    'PDF storage requires SUPABASE_KEY to be the legacy service_role JWT; '
    'the anon key cannot protect private PDFs.'
)
_PDF_STORAGE_PATH_RE = re.compile(r'^[0-9a-f]{32}\.pdf$')


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
os.makedirs(PDFS_DIR, exist_ok=True)


def _allowed_origins():
    defaults = {
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
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


def _write_local_json_atomic(path, data):
    """Write JSON without exposing a half-written cache file to another request."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp_path = f'{path}.tmp-{uuid.uuid4().hex}'
    try:
        with open(tmp_path, 'w') as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _save_json_strict(path, data):
    """Persist critical metadata or raise instead of silently falling back.

    General document saves intentionally tolerate a transient Supabase failure
    and retain a local cache. A completed PDF points at an object in a private
    bucket, so acknowledging it without durable metadata would strand the
    object after Render restarts. PDF create/delete flows use this strict path.
    """
    file_id = os.path.basename(path)
    _write_local_json_atomic(path, data)
    if supabase:
        # Do the fallible remote operation last. Once it succeeds there are no
        # remaining steps that can turn the write into a false success.
        supabase.table(SUPABASE_TABLE).upsert({'id': file_id, 'data': data}).execute()


def _delete_json_blob(path, *, strict=False):
    """Delete a JSON-storage row and its local cache copy.

    Existing document deletion code historically removed only local files.
    PDF deletion uses this helper so extracted text cannot remain orphaned in
    Supabase. Callers can request strict error propagation when user-visible
    deletion must not report a false success.
    """
    file_id = os.path.basename(path)
    remote_error = None
    local_error = None
    if supabase:
        try:
            supabase.table(SUPABASE_TABLE).delete().eq('id', file_id).execute()
        except Exception as exc:
            remote_error = exc
            print(f'Supabase delete failed for {file_id}: {exc}', flush=True)
    if remote_error is None or not strict:
        try:
            if os.path.exists(path):
                os.remove(path)
        except OSError as exc:
            local_error = exc
            print(f'Local JSON delete failed for {file_id}: {exc}', flush=True)
            if strict:
                raise
    if remote_error is not None and strict:
        raise remote_error
    return remote_error is None and local_error is None


def _board_file(item_id):
    return os.path.join(DATA_DIR, f'board-{item_id}.json')


def _sheet_file(item_id):
    return os.path.join(DATA_DIR, f'sheet-{item_id}.json')


def _report_file(item_id):
    return os.path.join(DATA_DIR, f'report-{item_id}.json')


def _pdf_file(item_id):
    return os.path.join(DATA_DIR, f'pdf-{item_id}.json')


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


def _legacy_visitor_password_enabled():
    return _env_flag('S8_ENABLE_LEGACY_VISITOR_PASSWORD', default=not PRODUCTION)


def _requires_access_setup():
    return not _owner_password_configured()


def _auth_configured():
    return not _requires_access_setup()


def _verify_studio_password(password):
    # Local-dev unconditional fallback: 'owner' always works on a developer
    # machine regardless of env vars or stored hashes. Production is unaffected
    # because PRODUCTION is True there. Do not remove — restoring it after a
    # contractor accidentally exports OWNER_PASSWORD locally is painful.
    if not PRODUCTION and password == ACCESS_OWNER:
        return True
    env_password = _env_studio_password()
    if env_password is not None:
        return password == env_password
    stored_hash = _stored_studio_password_hash()
    if not stored_hash:
        return False
    return check_password_hash(stored_hash, password)


def _verify_visitor_password(password):
    if not PRODUCTION and password == ACCESS_VISITOR:
        return True
    if not _legacy_visitor_password_enabled():
        return False
    env_password = _env_visitor_password()
    if env_password is not None:
        return password == env_password
    stored_hash = _stored_visitor_password_hash()
    if not stored_hash:
        return False
    return check_password_hash(stored_hash, password)


def _access_profile_pepper():
    return (os.getenv('S8_ACCESS_PROFILE_PEPPER') or os.getenv('ACCESS_PROFILE_PEPPER') or '').strip()


def _access_profile_password_storage_ready():
    return bool(_access_profile_pepper()) or not PRODUCTION


def _access_profile_password_material(password):
    pepper = _access_profile_pepper()
    if not pepper:
        return password
    return f'{pepper}\0{password}'


def _hash_access_profile_password(password):
    if not _access_profile_password_storage_ready():
        raise RuntimeError('missing_access_profile_pepper')
    return generate_password_hash(_access_profile_password_material(password)), bool(_access_profile_pepper())


def _access_profile_password_cipher():
    secret = _access_profile_pepper()
    if not secret and not PRODUCTION:
        secret = app.secret_key
    if not secret:
        return None
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode('utf-8')).digest())
    return Fernet(key)


def _encrypt_access_profile_password(password):
    cipher = _access_profile_password_cipher()
    if not cipher:
        raise RuntimeError('missing_access_profile_pepper')
    token = cipher.encrypt(password.encode('utf-8')).decode('utf-8')
    return f'fernet:{token}'


def _decrypt_access_profile_password(profile):
    secret = (profile or {}).get('password_secret') or ''
    if not secret.startswith('fernet:'):
        return None
    cipher = _access_profile_password_cipher()
    if not cipher:
        return None
    try:
        return cipher.decrypt(secret.removeprefix('fernet:').encode('utf-8')).decode('utf-8')
    except (InvalidToken, TypeError, UnicodeDecodeError, ValueError):
        return None


def _check_access_profile_password(profile, password):
    stored_hash = profile.get('password_hash') or ''
    if not stored_hash:
        return False
    if profile.get('password_peppered'):
        if not _access_profile_pepper():
            return False
        candidate = _access_profile_password_material(password)
    else:
        candidate = password
    try:
        return check_password_hash(stored_hash, candidate)
    except (TypeError, ValueError):
        return False


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


def _save_workspace_strict(workspace):
    _save_json_strict(WORKSPACE_FILE, _normalize_workspace(workspace))


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


def _save_boards_strict(boards):
    folders = _get_workspace().get('folders', [])
    _save_json_strict(BOARDS_FILE, [_normalize_board(board, folders) for board in boards])


def _load_sheets():
    folders = _get_workspace().get('folders', [])
    return [_normalize_doc(sheet, folders) for sheet in _load(SHEETS_FILE, [])]


def _save_sheets(sheets):
    folders = _get_workspace().get('folders', [])
    _save(SHEETS_FILE, [_normalize_doc(sheet, folders) for sheet in sheets])


def _save_sheets_strict(sheets):
    folders = _get_workspace().get('folders', [])
    _save_json_strict(SHEETS_FILE, [_normalize_doc(sheet, folders) for sheet in sheets])


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


def _save_gdocs_strict(gdocs):
    folders = _get_workspace().get('folders', [])
    _save_json_strict(GDOCS_FILE, [_normalize_gdrive_doc(d, folders) for d in gdocs])


def _load_gsheets():
    folders = _get_workspace().get('folders', [])
    return [_normalize_gdrive_doc(d, folders) for d in _load(GSHEETS_FILE, [])]


def _save_gsheets(gsheets):
    folders = _get_workspace().get('folders', [])
    _save(GSHEETS_FILE, [_normalize_gdrive_doc(d, folders) for d in gsheets])


def _save_gsheets_strict(gsheets):
    folders = _get_workspace().get('folders', [])
    _save_json_strict(GSHEETS_FILE, [_normalize_gdrive_doc(d, folders) for d in gsheets])


def _load_reports():
    return _load(REPORTS_FILE, [])


def _save_reports(reports):
    _save(REPORTS_FILE, reports)


def _save_reports_strict(reports):
    _save_json_strict(REPORTS_FILE, reports)


def _load_report(report_id):
    return _load(_report_file(report_id), None)


def _save_report(report_id, data):
    _save(_report_file(report_id), data)


def _normalize_pdf_text_status(value, text_chars):
    if text_chars <= 0:
        return 'no_text'
    requested = str(value or '').strip()
    return requested if requested in PDF_TEXT_STATUSES and requested != 'no_text' else 'indexed'


def _normalize_pdf_text_index_version(value):
    if isinstance(value, bool):
        return PDF_LEGACY_TEXT_INDEX_VERSION
    if isinstance(value, int):
        version = value
    elif isinstance(value, str) and re.fullmatch(r'\d+', value.strip()):
        version = int(value.strip())
    else:
        return PDF_LEGACY_TEXT_INDEX_VERSION
    return version if version >= 0 else PDF_LEGACY_TEXT_INDEX_VERSION


def _normalize_pdf(item, folders):
    source = dict(item or {})
    pdf = _normalize_doc(source, folders)
    pdf['original_filename'] = str(source.get('original_filename') or '').strip()
    pdf['storage_path'] = str(source.get('storage_path') or '').strip()
    try:
        pdf['size_bytes'] = max(0, int(source.get('size_bytes') or 0))
    except (TypeError, ValueError):
        pdf['size_bytes'] = 0
    try:
        pdf['page_count'] = max(0, int(source.get('page_count') or 0))
    except (TypeError, ValueError):
        pdf['page_count'] = 0
    try:
        pdf['text_chars'] = max(0, int(source.get('text_chars') or 0))
    except (TypeError, ValueError):
        pdf['text_chars'] = 0
    pdf['text_status'] = _normalize_pdf_text_status(
        source.get('text_status'),
        pdf['text_chars'],
    )
    pdf['text_index_version'] = _normalize_pdf_text_index_version(
        source.get('text_index_version'),
    )
    return pdf


def _load_pdfs():
    folders = _get_workspace().get('folders', [])
    raw = _load(PDFS_FILE, [])
    return [_normalize_pdf(item, folders) for item in raw if isinstance(item, dict)]


def _save_pdfs(pdfs):
    folders = _get_workspace().get('folders', [])
    _save(PDFS_FILE, [_normalize_pdf(item, folders) for item in pdfs])


def _save_pdfs_strict(pdfs):
    folders = _get_workspace().get('folders', [])
    _save_json_strict(PDFS_FILE, [_normalize_pdf(item, folders) for item in pdfs])


def _load_pdf_text(pdf_id):
    data = _load(_pdf_file(pdf_id), None)
    if not isinstance(data, dict):
        return None
    detail = dict(data)
    detail['text_index_version'] = _normalize_pdf_text_index_version(
        detail.get('text_index_version'),
    )
    return detail


def _save_pdf_text_strict(pdf_id, data):
    detail = dict(data or {})
    detail['text_index_version'] = _normalize_pdf_text_index_version(
        detail.get('text_index_version'),
    )
    _save_json_strict(_pdf_file(pdf_id), detail)


def _doc_index_handlers():
    """Single registry for hierarchy and visitor-profile document kinds."""
    return {
        'board': (_load_boards, _save_boards, _save_boards_strict),
        'sheet': (_load_sheets, _save_sheets, _save_sheets_strict),
        'gdoc': (_load_gdocs, _save_gdocs, _save_gdocs_strict),
        'gsheet': (_load_gsheets, _save_gsheets, _save_gsheets_strict),
        'report': (_load_reports, _save_reports, _save_reports_strict),
        'pdf': (_load_pdfs, _save_pdfs, _save_pdfs_strict),
    }


ACCESS_PROFILE_DOC_KINDS = frozenset(_doc_index_handlers())


def _profile_doc_loaders():
    return {kind: handlers[0] for kind, handlers in _doc_index_handlers().items()}


def _normalize_access_doc(item):
    if not isinstance(item, dict):
        return None
    kind = (item.get('type') or item.get('kind') or '').strip()
    doc_id = str(item.get('id') or '').strip()
    if kind not in ACCESS_PROFILE_DOC_KINDS or not doc_id:
        return None
    return {'type': kind, 'id': doc_id}


def _normalize_access_profile(profile):
    source = dict(profile or {})
    now = datetime.now().isoformat()
    profile_id = str(source.get('id') or '').strip() or str(uuid.uuid4())[:8]
    folders = []
    seen_folders = set()
    for folder_id in source.get('folders') or []:
        folder_id = str(folder_id or '').strip()
        if not folder_id or folder_id in seen_folders:
            continue
        seen_folders.add(folder_id)
        folders.append(folder_id)

    docs = []
    seen_docs = set()
    raw_docs = source.get('docs')
    if raw_docs is None:
        raw_docs = source.get('documents')
    for raw_doc in raw_docs or []:
        doc = _normalize_access_doc(raw_doc)
        if not doc:
            continue
        key = (doc['type'], doc['id'])
        if key in seen_docs:
            continue
        seen_docs.add(key)
        docs.append(doc)

    return {
        'id': profile_id,
        'name': (source.get('name') or 'Visitor access').strip() or 'Visitor access',
        'password_hash': source.get('password_hash') or '',
        'password_peppered': bool(source.get('password_peppered')),
        'password_secret': source.get('password_secret') or '',
        'active': source.get('active') is not False,
        'workspace': bool(source.get('workspace')),
        'folders': folders,
        'docs': docs,
        'created_at': source.get('created_at') or now,
        'updated_at': source.get('updated_at') or source.get('created_at') or now,
    }


def _load_access_profiles():
    raw = _load(ACCESS_PROFILES_FILE, [])
    if not isinstance(raw, list):
        raw = []
    profiles = [_normalize_access_profile(profile) for profile in raw if isinstance(profile, dict)]
    if profiles != raw:
        _save_access_profiles(profiles)
    return profiles


def _save_access_profiles(profiles):
    _save(ACCESS_PROFILES_FILE, [_normalize_access_profile(profile) for profile in profiles])


def _find_access_profile(profile_id):
    profile_id = str(profile_id or '').strip()
    if not profile_id:
        return None
    return next((p for p in _load_access_profiles() if p.get('id') == profile_id), None)


def _access_profile_for_password(password):
    if not password:
        return None
    for profile in _load_access_profiles():
        if not profile.get('active') or not profile.get('password_hash'):
            continue
        if _check_access_profile_password(profile, password):
            return profile
    return None


def _current_access_profile():
    if not _is_visitor_authed():
        return None
    profile_id = session.get('visitor_profile_id')
    if not profile_id:
        return None
    profile = _find_access_profile(profile_id)
    if not profile or not profile.get('active'):
        return None
    return profile


def _ancestor_folder_ids(folder_id, folders):
    folder_map = {f.get('id'): f for f in folders}
    folder_ids = []
    cursor = folder_id
    visited = set()
    while cursor and cursor not in visited:
        visited.add(cursor)
        folder = folder_map.get(cursor)
        if not folder:
            break
        folder_ids.append(cursor)
        cursor = folder.get('parent_id')
    return folder_ids


def _profile_scope(profile, *, workspace=None, docs_by_kind=None):
    ws = workspace if workspace is not None else _get_workspace()
    folders = ws.get('folders', [])
    folder_map = {f.get('id'): f for f in folders}
    loaders = _profile_doc_loaders()
    docs_by_kind = docs_by_kind or {kind: loader() for kind, loader in loaders.items()}
    allowed_docs = {kind: set() for kind in loaders}
    visible_folder_ids = set()

    if profile.get('workspace'):
        visible_folder_ids = set(folder_map)
        for kind, docs in docs_by_kind.items():
            allowed_docs[kind] = {doc.get('id') for doc in docs if doc.get('id')}
        return {'folders': visible_folder_ids, 'docs': allowed_docs}

    content_folder_ids = set()
    for folder_id in profile.get('folders') or []:
        if folder_id not in folder_map:
            continue
        content_folder_ids.update(_folder_with_descendants(folder_id, folders))
        visible_folder_ids.update(_ancestor_folder_ids(folder_id, folders))

    visible_folder_ids.update(content_folder_ids)

    for kind, docs in docs_by_kind.items():
        for doc in docs:
            doc_id = doc.get('id')
            if not doc_id:
                continue
            if doc.get('folder_id') in content_folder_ids:
                allowed_docs[kind].add(doc_id)
                visible_folder_ids.update(_ancestor_folder_ids(doc.get('folder_id'), folders))

    explicit_docs = profile.get('docs') or []
    for access_doc in explicit_docs:
        kind = access_doc.get('type')
        doc_id = access_doc.get('id')
        if kind not in allowed_docs or not doc_id:
            continue
        doc = next((item for item in docs_by_kind.get(kind, []) if item.get('id') == doc_id), None)
        if not doc:
            continue
        allowed_docs[kind].add(doc_id)
        visible_folder_ids.update(_ancestor_folder_ids(doc.get('folder_id'), folders))

    return {'folders': visible_folder_ids, 'docs': allowed_docs}


def _profile_visible_folders(profile, *, workspace=None, docs_by_kind=None):
    ws = workspace if workspace is not None else _get_workspace()
    folders = ws.get('folders', [])
    scope = _profile_scope(profile, workspace=ws, docs_by_kind=docs_by_kind)
    visible = []
    for folder in folders:
        if folder.get('id') not in scope['folders']:
            continue
        item = dict(folder)
        if item.get('parent_id') not in scope['folders']:
            item['parent_id'] = None
        visible.append(item)
    return visible


def _profile_visible_docs(profile, kind, docs, *, workspace=None, docs_by_kind=None):
    if kind not in ACCESS_PROFILE_DOC_KINDS:
        return []
    scope = _profile_scope(profile, workspace=workspace, docs_by_kind=docs_by_kind)
    allowed = scope['docs'].get(kind, set())
    return [doc for doc in docs if doc.get('id') in allowed]


def _visitor_visible_docs(kind, docs, *, workspace=None, docs_by_kind=None):
    profile = _current_access_profile()
    if profile:
        return _profile_visible_docs(profile, kind, docs, workspace=workspace, docs_by_kind=docs_by_kind)
    folders = (workspace or _get_workspace()).get('folders', [])
    return [doc for doc in docs if _doc_is_visitor_visible(doc, folders)]


def _visitor_visible_folders(workspace=None, docs_by_kind=None):
    ws = workspace if workspace is not None else _get_workspace()
    profile = _current_access_profile()
    if profile:
        return _profile_visible_folders(profile, workspace=ws, docs_by_kind=docs_by_kind)
    folders = ws.get('folders', [])
    return [f for f in folders if _folder_is_visitor_visible(f, folders)]


def _sanitize_access_profile_payload(data, existing=None):
    profile = _normalize_access_profile(existing or {})
    folders = _get_workspace().get('folders', [])
    folder_ids = {folder.get('id') for folder in folders}
    docs_by_kind = {kind: loader() for kind, loader in _profile_doc_loaders().items()}
    now = datetime.now().isoformat()

    if 'name' in data:
        profile['name'] = (data.get('name') or '').strip() or profile.get('name') or 'Visitor access'
    if 'active' in data:
        profile['active'] = data.get('active') is not False
    if 'workspace' in data:
        profile['workspace'] = bool(data.get('workspace'))
    if 'folders' in data:
        next_folders = []
        seen = set()
        for folder_id in data.get('folders') or []:
            folder_id = str(folder_id or '').strip()
            if folder_id and folder_id in folder_ids and folder_id not in seen:
                seen.add(folder_id)
                next_folders.append(folder_id)
        profile['folders'] = next_folders
    if 'docs' in data:
        next_docs = []
        seen = set()
        valid_docs = {
            kind: {doc.get('id') for doc in docs if doc.get('id')}
            for kind, docs in docs_by_kind.items()
        }
        for raw_doc in data.get('docs') or []:
            doc = _normalize_access_doc(raw_doc)
            if not doc or doc['id'] not in valid_docs.get(doc['type'], set()):
                continue
            key = (doc['type'], doc['id'])
            if key in seen:
                continue
            seen.add(key)
            next_docs.append(doc)
        profile['docs'] = next_docs
    password = data.get('password')
    if isinstance(password, str) and password:
        profile['password_hash'], profile['password_peppered'] = _hash_access_profile_password(password)
        profile['password_secret'] = _encrypt_access_profile_password(password)

    profile['updated_at'] = now
    return _normalize_access_profile(profile)


def _serialize_access_profile(profile):
    normalized = _normalize_access_profile(profile)
    docs_by_kind = {kind: loader() for kind, loader in _profile_doc_loaders().items()}
    scope = _profile_scope(normalized, docs_by_kind=docs_by_kind)
    password = _decrypt_access_profile_password(normalized)
    return {
        'id': normalized['id'],
        'name': normalized['name'],
        'active': normalized['active'],
        'workspace': normalized['workspace'],
        'folders': normalized['folders'],
        'docs': normalized['docs'],
        'has_password': bool(normalized.get('password_hash')),
        'password': password,
        'password_retrievable': password is not None,
        'created_at': normalized['created_at'],
        'updated_at': normalized['updated_at'],
        'visible_folder_count': len(scope['folders']),
        'visible_doc_count': sum(len(ids) for ids in scope['docs'].values()),
    }


def _load_r_tokens():
    return _load(R_TOKENS_FILE, [])


def _save_r_tokens(tokens):
    _save(R_TOKENS_FILE, tokens)


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


def _fetch_gsheet_text_all_tabs(file_id, access_token, timeout=25):
    """Fetch every tab of a Google Sheet via the Sheets API and concatenate
    into one CSV blob. Returns text on success, None on failure.

    Why this exists: Drive's `export?mimeType=text/csv` only returns the FIRST
    tab. Multi-tab sheets — which are common (raw-data + cleaned-data + summary
    layouts) — would silently lose tabs 2..N from the search index. The Sheets
    API exposes per-tab values, so we iterate them all."""
    import csv as _csv
    import io as _io
    meta_url = (
        f'https://sheets.googleapis.com/v4/spreadsheets/{file_id}'
        f'?fields=sheets.properties.title'
    )
    try:
        req = _urllib_request.Request(meta_url, headers={
            'Authorization': f'Bearer {access_token}',
        })
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            meta = json.loads(resp.read().decode('utf-8'))
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError):
        return None

    titles = [
        (s.get('properties') or {}).get('title')
        for s in (meta.get('sheets') or [])
    ]
    titles = [t for t in titles if t]
    if not titles:
        return None

    out_io = _io.StringIO()
    writer = _csv.writer(out_io)
    fetched_any = False
    for title in titles:
        range_q = _urllib_parse.quote(title, safe='')
        values_url = (
            f'https://sheets.googleapis.com/v4/spreadsheets/{file_id}'
            f'/values/{range_q}'
        )
        try:
            req = _urllib_request.Request(values_url, headers={
                'Authorization': f'Bearer {access_token}',
            })
            with _urllib_request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
        except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError):
            continue
        rows = payload.get('values') or []
        if not rows:
            continue
        fetched_any = True
        # Tab title as its own row so the name lands in the search index too.
        writer.writerow([title])
        for row in rows:
            writer.writerow([str(c) for c in row])

    if not fetched_any:
        return None
    text = out_io.getvalue().strip()
    return text or None


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
        # Sheets: prefer the Sheets API so every tab is indexed. Drive's
        # CSV export silently returns only tab 1.
        if kind == 'gsheet':
            text = _fetch_gsheet_text_all_tabs(
                file_id, access_token, timeout=max(timeout, 25),
            )
            if text:
                return text
            # Fall through to the Drive CSV export below as a tab-1 snapshot.
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


def _list_docs_sorted(docs, *, visitor=False, kind=None):
    """Common list-endpoint shape: visitor filter (when applicable) + sort by
    created_at desc. Keeps owner and visitor listings from drifting."""
    if visitor:
        docs = _visitor_visible_docs(kind, docs) if kind else [
            d for d in docs if _doc_is_visitor_visible(d, _get_workspace().get('folders', []))
        ]
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


def _visitor_doc_load(doc_id, *, kind, load_index, doc_file_fn, default_payload):
    """Visitor doc fetch: parallel reads of workspace + doc index + payload,
    then a visitor-visibility check. Returns (payload, error) where exactly
    one of the two is None. Caller jsonifies the payload or returns the error.
    """
    workspace_future = _io_executor.submit(_get_workspace)
    docs_future = _io_executor.submit(load_index)
    payload_future = _io_executor.submit(_load, doc_file_fn(doc_id), default_payload)

    workspace = workspace_future.result()
    docs = docs_future.result()
    visible_docs = _visitor_visible_docs(kind, docs, workspace=workspace, docs_by_kind={kind: docs})
    doc = next((d for d in visible_docs if d['id'] == doc_id), None)
    if not doc:
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


def _profile_visitor_session_is_valid():
    if not _is_visitor_authed():
        return False
    if not session.get('visitor_profile_id'):
        return True
    return _current_access_profile() is not None


def _clear_visitor_session():
    session.pop('visitor_authed', None)
    session.pop('visitor_profile_id', None)
    session.modified = True


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
        if _is_studio_authed():
            return fn(*args, **kwargs)
        if not _profile_visitor_session_is_valid():
            if _is_visitor_authed():
                _clear_visitor_session()
                return jsonify({'error': 'Visitor access expired'}), 401
            return jsonify({'error': 'Password required'}), 401
        return fn(*args, **kwargs)
    return wrapped


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


def _delete_report_files(report_ids):
    for report_id in report_ids:
        fp = _report_file(report_id)
        if os.path.exists(fp):
            os.remove(fp)


@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    visitor_profile = _current_access_profile()
    if _is_visitor_authed() and session.get('visitor_profile_id') and not visitor_profile:
        _clear_visitor_session()
    access = _current_access_level()
    return jsonify({
        'authenticated': bool(access),
        'access': access,
        'owner_authenticated': _is_studio_authed(),
        'visitor_authenticated': _is_visitor_authed(),
        'visitor_profile_id': visitor_profile.get('id') if visitor_profile else None,
        'visitor_profile_name': visitor_profile.get('name') if visitor_profile else None,
        'configured': _auth_configured(),
        'setup_allowed': ALLOW_BROWSER_AUTH_SETUP,
        'requires_setup': _requires_access_setup() and ALLOW_BROWSER_AUTH_SETUP,
    })


@app.route('/api/auth/setup', methods=['POST'])
def auth_setup():
    if not ALLOW_BROWSER_AUTH_SETUP:
        return jsonify({
            'error': 'Browser-based password setup is disabled in production. Configure OWNER_PASSWORD on the server.',
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
    if visitor_password and not _legacy_visitor_password_enabled():
        return jsonify({'error': 'Universal visitor passwords are disabled. Create visitor access profiles from the owner view.'}), 400
    if visitor_password:
        if len(visitor_password) < 6:
            return jsonify({'error': 'Visitor password must be at least 6 characters'}), 400
        auth['visitor_password_hash'] = generate_password_hash(visitor_password)
    auth['configured_at'] = datetime.now().isoformat()
    _save_auth_config(auth)
    session['studio_authed'] = True
    session.pop('visitor_authed', None)
    session.pop('visitor_profile_id', None)
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
        session.pop('visitor_profile_id', None)
        session.modified = True
        return jsonify({'authenticated': True, 'access': ACCESS_OWNER})

    visitor_profile = _access_profile_for_password(password)
    if visitor_profile:
        session['visitor_authed'] = True
        session['visitor_profile_id'] = visitor_profile['id']
        session.pop('studio_authed', None)
        session.modified = True
        return jsonify({
            'authenticated': True,
            'access': ACCESS_VISITOR,
            'visitor_profile_id': visitor_profile['id'],
            'visitor_profile_name': visitor_profile['name'],
        })

    if not _verify_visitor_password(password):
        return jsonify({'error': 'Wrong password'}), 401
    session['visitor_authed'] = True
    session.pop('visitor_profile_id', None)
    session.pop('studio_authed', None)
    session.modified = True
    return jsonify({'authenticated': True, 'access': ACCESS_VISITOR})


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.pop('studio_authed', None)
    _clear_visitor_session()
    session.modified = True
    return '', 204


def _r_token_serializer():
    return URLSafeSerializer(app.secret_key, salt='station8-r-token')


def _r_token_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'missing bearer token'}), 401
        token = auth_header[len('Bearer '):].strip()
        try:
            payload = _r_token_serializer().loads(token)
        except BadSignature:
            return jsonify({'error': 'invalid token'}), 401
        if not isinstance(payload, dict) or payload.get('kind') != 'r-token':
            return jsonify({'error': 'invalid token kind'}), 401
        token_id = payload.get('token_id')
        active_ids = {t['id'] for t in _load_r_tokens() if t.get('active', True)}
        if token_id not in active_ids:
            return jsonify({'error': 'token revoked'}), 401
        return fn(*args, **kwargs)
    return wrapped


# ── PDF storage and upload tickets ──────────────────────────────────────────

_pdf_bucket_ready_client_id = None
_pdf_bucket_ready_at = 0.0
_pdf_prune_offset = 0
_pdf_mutation_lock = RLock()


def _serialize_pdf_mutation(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        with _pdf_mutation_lock:
            return fn(*args, **kwargs)
    return wrapped


def _pdf_original_filename(value):
    name = str(value or '').replace('\\', '/').rsplit('/', 1)[-1].strip()
    name = re.sub(r'[\x00-\x1f\x7f]+', ' ', name).strip()
    return name[:255]


def _pdf_storage_path(ticket):
    path = f'{ticket}.pdf'
    return path if _PDF_STORAGE_PATH_RE.fullmatch(path) else None


def _local_pdf_path(storage_path):
    if not _PDF_STORAGE_PATH_RE.fullmatch(str(storage_path or '')):
        raise ValueError('invalid PDF storage path')
    return os.path.join(PDFS_DIR, storage_path)


def _bucket_public_value(bucket):
    return _bucket_value(bucket, 'public') is True


def _bucket_value(bucket, key):
    if isinstance(bucket, dict):
        return bucket.get(key)
    return getattr(bucket, key, None)


def _supabase_key_is_server_secret():
    """Recognize Supabase server-only keys without logging the credential."""
    key = str(SUPABASE_KEY or '').strip()
    if key.startswith(('sb_secret_', 'sb_publishable_')):
        # The pinned supabase-py client accepts legacy JWT keys. New opaque
        # key formats require a dependency upgrade before they can be used.
        return False
    parts = key.split('.')
    if len(parts) != 3:
        return False
    try:
        encoded = parts[1] + '=' * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded).decode('utf-8'))
    except Exception:
        return False
    return payload.get('role') == 'service_role'


def _pdf_bucket_config_matches(bucket):
    if _bucket_value(bucket, 'public') is not False:
        return False
    try:
        size_limit = int(_bucket_value(bucket, 'file_size_limit'))
    except (TypeError, ValueError):
        return False
    mime_types = _bucket_value(bucket, 'allowed_mime_types')
    return (
        size_limit == MAX_PDF_BYTES
        and isinstance(mime_types, (list, tuple))
        and set(mime_types) == set(PDF_BUCKET_MIME_TYPES)
    )


def _ensure_pdf_bucket():
    """Ensure the dedicated PDF bucket exists and is private.

    The image bucket is deliberately public for tldraw assets, so PDFs cannot
    share it without bypassing document privacy. A service-role-backed server
    can lazily create the separate bucket on the first owner upload.
    """
    global _pdf_bucket_ready_client_id, _pdf_bucket_ready_at
    if not supabase:
        return
    if not _supabase_key_is_server_secret() and not (
        app.config.get('TESTING') and not str(SUPABASE_KEY or '').strip()
    ):
        raise RuntimeError(PDF_SERVICE_ROLE_ERROR)
    client_id = id(supabase)
    now = time.time()
    if (
        _pdf_bucket_ready_client_id == client_id
        and now - _pdf_bucket_ready_at < PDF_BUCKET_CONFIG_TTL_SECONDS
    ):
        return

    desired = {
        'public': False,
        'file_size_limit': MAX_PDF_BYTES,
        'allowed_mime_types': list(PDF_BUCKET_MIME_TYPES),
    }
    bucket = None
    try:
        bucket = supabase.storage.get_bucket(PDF_BUCKET)
    except Exception:
        try:
            supabase.storage.create_bucket(
                PDF_BUCKET,
                options=desired,
            )
            bucket = supabase.storage.get_bucket(PDF_BUCKET)
        except Exception as exc:
            # A concurrent first request may have created it between the two
            # calls. One final read distinguishes that race from real failure.
            try:
                bucket = supabase.storage.get_bucket(PDF_BUCKET)
            except Exception:
                raise RuntimeError(f'PDF storage is unavailable: {exc}') from exc

    if not _pdf_bucket_config_matches(bucket):
        try:
            supabase.storage.update_bucket(PDF_BUCKET, desired)
            bucket = supabase.storage.get_bucket(PDF_BUCKET)
        except Exception as exc:
            raise RuntimeError(f'PDF storage configuration failed: {exc}') from exc
    if not _pdf_bucket_config_matches(bucket):
        raise RuntimeError('The Supabase pdfs bucket configuration is unsafe')
    _pdf_bucket_ready_client_id = client_id
    _pdf_bucket_ready_at = now


def _pdf_storage_size(storage_path):
    if not supabase:
        return os.path.getsize(_local_pdf_path(storage_path))
    _ensure_pdf_bucket()
    bucket = supabase.storage.from_(PDF_BUCKET)
    listed = bucket.list(None, {
        'limit': 2,
        'offset': 0,
        'sortBy': {'column': 'name', 'order': 'asc'},
        'search': storage_path,
    }) or []
    item = next(
        (entry for entry in listed if isinstance(entry, dict) and entry.get('name') == storage_path),
        None,
    )
    if item is None:
        raise FileNotFoundError(storage_path)
    metadata = item.get('metadata') if isinstance(item.get('metadata'), dict) else {}
    raw_size = metadata.get('size', item.get('size'))
    try:
        size = int(raw_size)
    except (TypeError, ValueError) as exc:
        raise RuntimeError('PDF storage returned no object size') from exc
    if size < 0:
        raise RuntimeError('PDF storage returned an invalid object size')
    return size


def _pdf_storage_bytes(storage_path):
    if supabase:
        _ensure_pdf_bucket()
        return supabase.storage.from_(PDF_BUCKET).download(storage_path)
    with open(_local_pdf_path(storage_path), 'rb') as f:
        return f.read(MAX_PDF_BYTES + 1)


def _delete_pdf_binary(storage_path, *, strict=False):
    if not storage_path:
        return True
    error = None
    if supabase:
        try:
            _ensure_pdf_bucket()
            supabase.storage.from_(PDF_BUCKET).remove([storage_path])
        except Exception as exc:
            error = exc
    else:
        try:
            path = _local_pdf_path(storage_path)
            if os.path.exists(path):
                os.remove(path)
        except Exception as exc:
            error = exc
    if error is not None:
        print(f'PDF object delete failed for {storage_path}: {error}', flush=True)
        if strict:
            raise error
        return False
    return True


def _delete_unreferenced_pdf_artifacts(pdf_id, storage_path, *, strict=False):
    """Delete extracted text first so the binary remains a retry marker."""
    text_deleted = _delete_json_blob(_pdf_file(pdf_id), strict=strict)
    if not text_deleted:
        return False
    return _delete_pdf_binary(storage_path, strict=strict)


def _pdf_reference_paths_for_prune():
    """Return a conservative union of remote and local PDF references.

    Pruning must stop if the authoritative Supabase index cannot be read. A
    stale or missing cache must never make a live private object look orphaned.
    """
    sources = []
    local = _load_local_json(PDFS_FILE, None)
    if isinstance(local, list):
        sources.append(local)

    if supabase:
        try:
            response = (
                supabase.table(SUPABASE_TABLE)
                .select('data')
                .eq('id', os.path.basename(PDFS_FILE))
                .execute()
            )
        except Exception as exc:
            print(f'PDF orphan prune skipped; index read failed: {exc}', flush=True)
            return None
        rows = response.data
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            # An anon/RLS-denied select can look exactly like an empty table.
            # Never interpret that ambiguity as permission to delete objects.
            print('PDF orphan prune skipped; authoritative index row was not returned', flush=True)
            return None
        remote = rows[0].get('data')
        if not isinstance(remote, list):
            print('PDF orphan prune skipped; index is malformed', flush=True)
            return None
        sources.append(remote)

    references = set()
    for records in sources:
        for record in records:
            if not isinstance(record, dict):
                continue
            storage_path = str(record.get('storage_path') or '')
            if _PDF_STORAGE_PATH_RE.fullmatch(storage_path):
                references.add(storage_path)
            pdf_id = str(record.get('id') or '')
            derived_path = f'{pdf_id}.pdf'
            if _PDF_STORAGE_PATH_RE.fullmatch(derived_path):
                references.add(derived_path)
    return references


def _authoritative_pdf_index_state(pdf_id):
    """Return present/absent/unknown without Supabase-to-cache fallback."""
    if supabase:
        try:
            response = (
                supabase.table(SUPABASE_TABLE)
                .select('data')
                .eq('id', os.path.basename(PDFS_FILE))
                .execute()
            )
        except Exception as exc:
            print(f'PDF authoritative index read failed: {exc}', flush=True)
            return 'unknown'
        rows = response.data
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            return 'unknown'
        records = rows[0].get('data')
    else:
        if not os.path.exists(PDFS_FILE):
            return 'absent'
        records = _load_local_json(PDFS_FILE, None)
    if not isinstance(records, list):
        return 'unknown'
    return 'present' if any(
        isinstance(record, dict) and record.get('id') == pdf_id
        for record in records
    ) else 'absent'


def _pdf_timestamp_epoch(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        normalized = value.strip().replace('Z', '+00:00')
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_timezone.utc)
    return parsed.timestamp()


def _prune_stale_pdf_objects(now=None):
    """Best-effort, bounded cleanup for uploads abandoned before completion."""
    global _pdf_prune_offset
    now = float(now if now is not None else time.time())
    references = _pdf_reference_paths_for_prune()
    if references is None:
        return 0

    candidates = []
    next_offset = 0
    try:
        if supabase:
            _ensure_pdf_bucket()
            bucket = supabase.storage.from_(PDF_BUCKET)
            candidates = bucket.list(None, {
                'limit': MAX_PDF_PRUNE_SCAN,
                'offset': _pdf_prune_offset,
                'sortBy': {'column': 'name', 'order': 'asc'},
            }) or []
            next_offset = (
                _pdf_prune_offset + len(candidates)
                if len(candidates) >= MAX_PDF_PRUNE_SCAN else 0
            )
        else:
            with os.scandir(PDFS_DIR) as entries:
                for index, entry in enumerate(entries):
                    if index < _pdf_prune_offset:
                        continue
                    if len(candidates) >= MAX_PDF_PRUNE_SCAN:
                        break
                    if entry.is_file(follow_symlinks=False):
                        candidates.append({
                            'name': entry.name,
                            'created_at': entry.stat(follow_symlinks=False).st_mtime,
                        })
            next_offset = (
                _pdf_prune_offset + len(candidates)
                if len(candidates) >= MAX_PDF_PRUNE_SCAN else 0
            )
    except Exception as exc:
        print(f'PDF orphan listing failed: {exc}', flush=True)
        return 0
    finally:
        _pdf_prune_offset = next_offset

    stale = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        name = str(candidate.get('name') or '')
        if not _PDF_STORAGE_PATH_RE.fullmatch(name) or name in references:
            continue
        created_at = _pdf_timestamp_epoch(candidate.get('created_at'))
        if created_at is None or now - created_at <= PDF_UPLOAD_TICKET_TTL_SECONDS:
            continue
        stale.append(name)
        if len(stale) >= MAX_PDF_PRUNE_DELETE:
            break

    removed = 0
    for name in stale:
        pdf_id = name[:-4]
        try:
            if _delete_unreferenced_pdf_artifacts(pdf_id, name, strict=False):
                removed += 1
        except Exception as exc:
            print(f'PDF orphan cleanup failed for {name}: {exc}', flush=True)
    return removed


def _pending_pdf_uploads():
    raw = session.get(PDF_UPLOAD_TICKETS_SESSION_KEY)
    pending = dict(raw) if isinstance(raw, dict) else {}
    now = time.time()
    changed = not isinstance(raw, dict)
    for ticket, item in list(pending.items()):
        try:
            created_at = float(item.get('created_at') or 0)
        except (AttributeError, TypeError, ValueError):
            created_at = 0
        valid_ticket = bool(_PDF_STORAGE_PATH_RE.fullmatch(f'{ticket}.pdf'))
        if not valid_ticket or now - created_at > PDF_UPLOAD_TICKET_TTL_SECONDS:
            storage_path = item.get('storage_path') if isinstance(item, dict) else None
            # Session data lives in the signed browser cookie. If the client
            # lost the completion response it can legitimately present an old
            # cookie containing a ticket that already became a PDF. Never let
            # stale-ticket pruning delete that completed document's object.
            index_state = _authoritative_pdf_index_state(ticket) if valid_ticket else 'absent'
            if index_state == 'present':
                deleted = True
            elif index_state == 'unknown':
                deleted = False
            else:
                deleted = (
                    _delete_unreferenced_pdf_artifacts(ticket, storage_path, strict=False)
                    if valid_ticket else _delete_pdf_binary(storage_path, strict=False)
                )
            if deleted:
                pending.pop(ticket, None)
                changed = True
    if changed:
        session[PDF_UPLOAD_TICKETS_SESSION_KEY] = pending
        session.modified = True
    return pending


def _save_pending_pdf_uploads(pending):
    session[PDF_UPLOAD_TICKETS_SESSION_KEY] = pending
    session.modified = True


def _drop_pending_pdf_upload(ticket, pending=None):
    pending = pending if pending is not None else _pending_pdf_uploads()
    pending.pop(ticket, None)
    _save_pending_pdf_uploads(pending)


def _normalize_pdf_pages(raw_pages, declared_page_count):
    if raw_pages is None:
        raw_pages = []
    if not isinstance(raw_pages, list):
        raise ValueError('pages must be a list')
    if len(raw_pages) > MAX_PDF_PAGES:
        raise OverflowError('too many PDF pages')

    pages = []
    seen = set()
    total_chars = 0
    for index, raw_page in enumerate(raw_pages):
        if isinstance(raw_page, dict):
            page_number = raw_page.get('page', index + 1)
            text = raw_page.get('text', '')
        else:
            page_number = index + 1
            text = raw_page
        try:
            page_number = int(page_number)
        except (TypeError, ValueError):
            raise ValueError('invalid PDF page number')
        if page_number < 1 or page_number > MAX_PDF_PAGES or page_number in seen:
            raise ValueError('invalid or duplicate PDF page number')
        if not isinstance(text, str):
            raise ValueError('PDF page text must be a string')
        if len(text) > MAX_PDF_PAGE_TEXT_CHARS:
            raise OverflowError('PDF page text is too large')
        total_chars += len(text)
        if total_chars > MAX_PDF_TEXT_CHARS:
            raise OverflowError('PDF text is too large')
        seen.add(page_number)
        pages.append({'page': page_number, 'text': text})

    pages.sort(key=lambda item: item['page'])
    max_page = pages[-1]['page'] if pages else 0
    try:
        page_count = int(declared_page_count or max_page)
    except (TypeError, ValueError):
        raise ValueError('invalid PDF page count')
    if page_count < max_page:
        raise ValueError('page count is smaller than extracted pages')
    if page_count < 0 or page_count > MAX_PDF_PAGES:
        raise OverflowError('too many PDF pages')
    return pages, page_count, total_chars


def _pdf_client_record(record):
    """Strip internal storage metadata from every client-facing record."""
    return {
        key: value for key, value in record.items()
        if key not in {'storage_path', 'original_filename'}
    }


def _pdf_download_filename(record):
    name = str(record.get('name') or 'PDF').strip()
    name = re.sub(r'[\x00-\x1f\x7f]+', ' ', name)
    name = name.replace('/', '-').replace('\\', '-').strip(' .') or 'PDF'
    stem = name[:-4] if name.lower().endswith('.pdf') else name
    return f'{stem[:251]}.pdf'


def _pdf_signed_read_url(storage_path):
    _ensure_pdf_bucket()
    signed = supabase.storage.from_(PDF_BUCKET).create_signed_url(
        storage_path,
        PDF_READ_URL_TTL_SECONDS,
    )
    url = signed.get('signedURL') or signed.get('signed_url')
    if not url:
        raise RuntimeError('storage returned no signed URL')
    return url


def _pdf_file_gateway(record):
    storage_path = record.get('storage_path') or ''
    if not _PDF_STORAGE_PATH_RE.fullmatch(storage_path):
        return jsonify({'error': 'PDF file is unavailable'}), 404
    if supabase:
        try:
            url = _pdf_signed_read_url(storage_path)
        except Exception as exc:
            print(f'PDF signed URL failed for {storage_path}: {exc}', flush=True)
            return jsonify({'error': 'PDF file is temporarily unavailable'}), 502
        response = redirect(url, code=302)
    else:
        path = _local_pdf_path(storage_path)
        if not os.path.exists(path):
            return jsonify({'error': 'PDF file is unavailable'}), 404
        response = send_from_directory(
            PDFS_DIR,
            storage_path,
            mimetype='application/pdf',
            as_attachment=False,
            download_name=_pdf_download_filename(record),
        )
    response.headers['Cache-Control'] = 'no-store, private'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


def _cleanup_pdf_completion(ticket, pending, storage_path):
    if _delete_unreferenced_pdf_artifacts(ticket, storage_path, strict=False):
        _drop_pending_pdf_upload(ticket, pending)


@app.route('/api/pdfs/upload-ticket', methods=['POST'])
@_studio_auth_required
@_serialize_pdf_mutation
def create_pdf_upload_ticket():
    body = request.get_json(silent=True) or {}
    filename = _pdf_original_filename(body.get('filename'))
    mime_type = str(body.get('mime_type') or '').strip().lower()
    try:
        size_bytes = int(body.get('size_bytes') or 0)
    except (TypeError, ValueError):
        size_bytes = 0
    if not filename or not filename.lower().endswith('.pdf'):
        return jsonify({'error': 'A .pdf filename is required'}), 400
    if mime_type not in {'application/pdf', 'application/x-pdf'}:
        return jsonify({'error': 'Only PDF files are supported'}), 400
    if size_bytes <= 0:
        return jsonify({'error': 'PDF is empty'}), 400
    if size_bytes > MAX_PDF_BYTES:
        return jsonify({'error': f'PDF exceeds the {MAX_PDF_BYTES} byte limit'}), 413

    pending = _pending_pdf_uploads()
    if len(pending) >= MAX_PENDING_PDF_UPLOADS:
        return jsonify({'error': 'Finish or cancel an existing PDF upload first'}), 429
    _prune_stale_pdf_objects()

    ticket = uuid.uuid4().hex
    storage_path = _pdf_storage_path(ticket)
    mode = 'local'
    # Keep local uploads on the same browser origin as the ticket request. In
    # development, Vite proxies /api from 127.0.0.1:5173 to localhost:5001;
    # returning request.url_root would send the follow-up PUT directly to the
    # other hostname, where the host-only owner session cookie is unavailable.
    # The frontend prefixes this relative path with VITE_API_URL in deployments
    # that use a separate backend origin.
    upload_url = f'/api/pdfs/upload/{ticket}'
    if supabase:
        try:
            _ensure_pdf_bucket()
            signed = supabase.storage.from_(PDF_BUCKET).create_signed_upload_url(storage_path)
            upload_url = signed.get('signed_url') or signed.get('signedURL')
            if not upload_url:
                raise RuntimeError('storage returned no signed upload URL')
            mode = 'supabase'
        except Exception as exc:
            print(f'PDF upload ticket failed: {exc}', flush=True)
            error = PDF_SERVICE_ROLE_ERROR if str(exc) == PDF_SERVICE_ROLE_ERROR else 'PDF storage is unavailable'
            return jsonify({'error': error}), 503

    pending[ticket] = {
        'created_at': time.time(),
        'filename': filename,
        'mime_type': mime_type,
        'size_bytes': size_bytes,
        'storage_path': storage_path,
        'mode': mode,
    }
    _save_pending_pdf_uploads(pending)
    response = jsonify({
        'ticket': ticket,
        'mode': mode,
        'upload_url': upload_url,
        'max_bytes': MAX_PDF_BYTES,
    })
    response.headers['Cache-Control'] = 'no-store, private'
    return response, 201


@app.route('/api/pdfs/upload/<ticket>', methods=['PUT', 'POST'])
@_studio_auth_required
@_serialize_pdf_mutation
def upload_pdf_local(ticket):
    pending = _pending_pdf_uploads()
    item = pending.get(ticket)
    if not item or item.get('mode') != 'local':
        return jsonify({'error': 'Upload ticket not found'}), 404
    uploaded = request.files.get('file')
    if uploaded is None:
        return jsonify({'error': 'PDF file is required'}), 400

    storage_path = item['storage_path']
    final_path = _local_pdf_path(storage_path)
    tmp_path = f'{final_path}.tmp-{uuid.uuid4().hex}'
    written = 0
    header = b''
    try:
        with open(tmp_path, 'wb') as f:
            while True:
                chunk = uploaded.stream.read(1024 * 1024)
                if not chunk:
                    break
                if len(header) < 1024:
                    header += chunk[:1024 - len(header)]
                written += len(chunk)
                if written > MAX_PDF_BYTES:
                    raise OverflowError
                f.write(chunk)
        if written != item['size_bytes']:
            return jsonify({'error': 'Uploaded PDF size does not match the ticket'}), 400
        if b'%PDF-' not in header:
            return jsonify({'error': 'Uploaded file is not a PDF'}), 400
        os.replace(tmp_path, final_path)
    except OverflowError:
        return jsonify({'error': f'PDF exceeds the {MAX_PDF_BYTES} byte limit'}), 413
    except OSError as exc:
        print(f'Local PDF upload failed: {exc}', flush=True)
        return jsonify({'error': 'Could not store PDF'}), 500
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    return jsonify({'ok': True}), 201


@app.route('/api/pdfs/upload-ticket', methods=['DELETE'])
@_studio_auth_required
@_serialize_pdf_mutation
def delete_pdf_upload_ticket():
    body = request.get_json(silent=True) or {}
    ticket = str(body.get('ticket') or '').strip()
    pending = _pending_pdf_uploads()
    item = pending.get(ticket)
    if not item:
        return '', 204
    index_state = _authoritative_pdf_index_state(ticket)
    if index_state == 'present':
        _drop_pending_pdf_upload(ticket, pending)
        return '', 204
    if index_state == 'unknown':
        return jsonify({'error': 'Could not safely determine PDF upload state'}), 503
    try:
        _delete_unreferenced_pdf_artifacts(
            ticket,
            item.get('storage_path'),
            strict=True,
        )
    except Exception:
        return jsonify({'error': 'Could not clean up PDF upload'}), 502
    _drop_pending_pdf_upload(ticket, pending)
    return '', 204


@app.route('/api/pdfs/complete', methods=['POST'])
@_studio_auth_required
@_serialize_pdf_mutation
def complete_pdf_upload():
    if request.content_length and request.content_length > MAX_PDF_COMPLETION_BYTES:
        return jsonify({'error': 'PDF text payload is too large'}), 413
    body = request.get_json(silent=True) or {}
    ticket = str(body.get('ticket') or '').strip()
    pending = _pending_pdf_uploads()
    item = pending.get(ticket)
    existing = next((pdf for pdf in _load_pdfs() if pdf.get('id') == ticket), None)
    if existing:
        if item:
            _drop_pending_pdf_upload(ticket, pending)
        return jsonify(_pdf_client_record(existing))
    if not item:
        return jsonify({'error': 'Upload ticket not found or expired'}), 404

    storage_path = item['storage_path']
    try:
        stored_size = _pdf_storage_size(storage_path)
    except (FileNotFoundError, OSError):
        return jsonify({'error': 'Upload the PDF before completing it'}), 409
    except Exception as exc:
        print(f'PDF size verification failed: {exc}', flush=True)
        return jsonify({'error': 'Could not verify uploaded PDF'}), 502
    if stored_size > MAX_PDF_BYTES:
        _cleanup_pdf_completion(ticket, pending, storage_path)
        return jsonify({'error': f'PDF exceeds the {MAX_PDF_BYTES} byte limit'}), 413
    if stored_size != item['size_bytes']:
        _cleanup_pdf_completion(ticket, pending, storage_path)
        return jsonify({'error': 'Uploaded PDF size does not match the ticket'}), 400
    try:
        blob = _pdf_storage_bytes(storage_path)
    except (FileNotFoundError, OSError):
        return jsonify({'error': 'Upload the PDF before completing it'}), 409
    except Exception as exc:
        print(f'PDF verification download failed: {exc}', flush=True)
        return jsonify({'error': 'Could not verify uploaded PDF'}), 502
    if len(blob) != stored_size:
        _cleanup_pdf_completion(ticket, pending, storage_path)
        return jsonify({'error': 'Uploaded PDF changed during verification'}), 409
    if b'%PDF-' not in blob[:1024]:
        _cleanup_pdf_completion(ticket, pending, storage_path)
        return jsonify({'error': 'Uploaded file is not a PDF'}), 400

    try:
        pages, page_count, text_chars = _normalize_pdf_pages(
            body.get('pages'),
            body.get('page_count'),
        )
    except OverflowError as exc:
        _cleanup_pdf_completion(ticket, pending, storage_path)
        return jsonify({'error': str(exc)}), 413
    except ValueError as exc:
        _cleanup_pdf_completion(ticket, pending, storage_path)
        return jsonify({'error': str(exc)}), 400

    filename = item['filename']
    default_name = os.path.splitext(filename)[0] or 'Untitled PDF'
    name = str(body.get('name') or default_name).strip() or default_name
    folders = _get_workspace().get('folders', [])
    text_status = _normalize_pdf_text_status(body.get('text_status'), text_chars)
    # Only the OCR-capable frontend knows it produced the current index
    # format. Uploads from an older cached frontend omit this marker and must
    # remain eligible for the viewer's one-time legacy reindex.
    text_index_version = (
        PDF_TEXT_INDEX_VERSION
        if body.get('text_index_version') == PDF_TEXT_INDEX_VERSION
        else PDF_LEGACY_TEXT_INDEX_VERSION
    )
    now = datetime.utcnow().isoformat() + 'Z'
    record = {
        'id': ticket,
        'name': name,
        'tags': _parse_tags(body.get('tags')),
        'folder_id': _normalize_folder_id(body.get('folder_id'), folders),
        'private': True if body.get('private') is True else (False if body.get('private') is False else None),
        'original_filename': filename,
        'storage_path': storage_path,
        'size_bytes': len(blob),
        'page_count': page_count,
        'text_status': text_status,
        'text_chars': text_chars,
        'text_index_version': text_index_version,
        'created_at': now,
        'updated_at': now,
    }
    detail = {
        'id': ticket,
        'pages': pages,
        'text_status': text_status,
        'text_chars': text_chars,
        'text_index_version': text_index_version,
        'created_at': now,
        'updated_at': now,
    }
    old_pdfs = _load_pdfs()
    next_pdfs = [pdf for pdf in old_pdfs if pdf.get('id') != ticket]
    index_save_started = False
    try:
        _save_pdf_text_strict(ticket, detail)
        index_save_started = True
        _save_pdfs_strict([*next_pdfs, record])
    except Exception as exc:
        print(f'PDF metadata persistence failed: {exc}', flush=True)
        if index_save_started:
            try:
                _save_pdfs_strict(old_pdfs)
            except Exception as rollback_exc:
                print(f'PDF index rollback failed: {rollback_exc}', flush=True)
            index_state = _authoritative_pdf_index_state(ticket)
            if index_state != 'absent':
                print(
                    f'PDF artifacts retained after ambiguous index write for {ticket}',
                    flush=True,
                )
                return jsonify({'error': 'Could not confirm PDF metadata persistence'}), 502
        _cleanup_pdf_completion(ticket, pending, storage_path)
        return jsonify({'error': 'Could not persist PDF metadata'}), 502

    _drop_pending_pdf_upload(ticket, pending)
    return jsonify(_pdf_client_record(record)), 201


@app.route('/api/pdfs', methods=['GET'])
@_studio_auth_required
def list_pdfs():
    pdfs = _list_docs_sorted(_load_pdfs())
    return jsonify([_pdf_client_record(pdf) for pdf in pdfs])


@app.route('/api/visitor/pdfs', methods=['GET'])
@_viewer_auth_required
def list_visitor_pdfs():
    pdfs = _list_docs_sorted(_load_pdfs(), visitor=True, kind='pdf')
    return jsonify([_pdf_client_record(pdf) for pdf in pdfs])


@app.route('/api/pdfs/<pdf_id>', methods=['GET'])
@_studio_auth_required
def get_pdf(pdf_id):
    record = next((pdf for pdf in _load_pdfs() if pdf.get('id') == pdf_id), None)
    if not record:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_pdf_client_record(record))


@app.route('/api/visitor/pdfs/<pdf_id>', methods=['GET'])
@_viewer_auth_required
def get_visitor_pdf(pdf_id):
    record = next(
        (pdf for pdf in _visitor_visible_docs('pdf', _load_pdfs()) if pdf.get('id') == pdf_id),
        None,
    )
    if not record:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_pdf_client_record(record))


@app.route('/api/pdfs/<pdf_id>', methods=['PATCH'])
@_studio_auth_required
@_serialize_pdf_mutation
def patch_pdf(pdf_id):
    body = request.get_json(silent=True) or {}
    pdfs = _load_pdfs()
    original = [dict(pdf) for pdf in pdfs]
    folders = _get_workspace().get('folders', [])
    record = next((pdf for pdf in pdfs if pdf.get('id') == pdf_id), None)
    if not record:
        return jsonify({'error': 'Not found'}), 404
    if 'name' in body:
        record['name'] = str(body.get('name') or '').strip() or record.get('name') or 'Untitled PDF'
    if 'tags' in body:
        record['tags'] = _parse_tags(body.get('tags'))
    if 'folder_id' in body:
        record['folder_id'] = _normalize_folder_id(body.get('folder_id'), folders)
    if 'private' in body:
        record['private'] = True if body.get('private') is True else (False if body.get('private') is False else None)
    record['updated_at'] = datetime.utcnow().isoformat() + 'Z'
    try:
        _save_pdfs_strict(pdfs)
    except Exception as exc:
        print(f'PDF patch persistence failed: {exc}', flush=True)
        try:
            _save_pdfs_strict(original)
        except Exception:
            pass
        return jsonify({'error': 'Could not update PDF'}), 502
    return jsonify(_pdf_client_record(record))


@app.route('/api/pdfs/<pdf_id>/text-index', methods=['PUT'])
@_studio_auth_required
@_serialize_pdf_mutation
def replace_pdf_text_index(pdf_id):
    """Replace browser-extracted/OCR page text for an existing PDF."""
    if request.content_length and request.content_length > MAX_PDF_COMPLETION_BYTES:
        return jsonify({'error': 'PDF text payload is too large'}), 413

    body = request.get_json(silent=True) or {}
    pdfs = _load_pdfs()
    original_pdfs = [dict(pdf) for pdf in pdfs]
    record = next((pdf for pdf in pdfs if pdf.get('id') == pdf_id), None)
    if not record:
        return jsonify({'error': 'Not found'}), 404

    try:
        pages, page_count, text_chars = _normalize_pdf_pages(
            body.get('pages'),
            body.get('page_count'),
        )
    except OverflowError as exc:
        return jsonify({'error': str(exc)}), 413
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    # Page count comes from the PDF.js parse performed when the immutable
    # binary was first uploaded. Reindexing may replace text, but it must not
    # be able to rewrite that authoritative binary property.
    stored_page_count = record.get('page_count', 0)
    if page_count != stored_page_count:
        return jsonify({'error': 'PDF page count does not match the stored file'}), 400

    original_detail = _load_pdf_text(pdf_id)
    text_status = _normalize_pdf_text_status(body.get('text_status'), text_chars)
    now = datetime.utcnow().isoformat() + 'Z'
    detail = dict(original_detail or {})
    detail.update({
        'id': pdf_id,
        'pages': pages,
        'text_status': text_status,
        'text_chars': text_chars,
        'text_index_version': PDF_TEXT_INDEX_VERSION,
        'updated_at': now,
    })
    if not detail.get('created_at'):
        detail['created_at'] = record.get('created_at') or now

    record['text_status'] = text_status
    record['text_chars'] = text_chars
    record['text_index_version'] = PDF_TEXT_INDEX_VERSION
    record['updated_at'] = now

    try:
        _save_pdf_text_strict(pdf_id, detail)
        _save_pdfs_strict(pdfs)
    except Exception as exc:
        print(f'PDF text reindex persistence failed for {pdf_id}: {exc}', flush=True)
        rollback_failed = False
        try:
            _save_pdfs_strict(original_pdfs)
        except Exception as rollback_exc:
            rollback_failed = True
            print(f'PDF text reindex metadata rollback failed for {pdf_id}: {rollback_exc}', flush=True)
        try:
            if original_detail is None:
                _delete_json_blob(_pdf_file(pdf_id), strict=True)
            else:
                _save_pdf_text_strict(pdf_id, original_detail)
        except Exception as rollback_exc:
            rollback_failed = True
            print(f'PDF text reindex detail rollback failed for {pdf_id}: {rollback_exc}', flush=True)
        error = (
            'Could not confirm PDF text index persistence'
            if rollback_failed
            else 'Could not update PDF text index'
        )
        return jsonify({'error': error}), 502

    return jsonify(_pdf_client_record(record))


@app.route('/api/pdfs/<pdf_id>', methods=['DELETE'])
@_studio_auth_required
@_serialize_pdf_mutation
def delete_pdf(pdf_id):
    pdfs = _load_pdfs()
    record = next((pdf for pdf in pdfs if pdf.get('id') == pdf_id), None)
    if not record:
        return jsonify({'error': 'Not found'}), 404
    remaining = [pdf for pdf in pdfs if pdf.get('id') != pdf_id]
    try:
        _save_pdfs_strict(remaining)
    except Exception as exc:
        print(f'PDF index deletion failed for {pdf_id}: {exc}', flush=True)
        try:
            _save_pdfs_strict(pdfs)
        except Exception as rollback_exc:
            print(f'PDF delete rollback failed for {pdf_id}: {rollback_exc}', flush=True)
        return jsonify({'error': 'Could not delete PDF'}), 502

    # The visible deletion is committed. Never resurrect an index entry after
    # an ambiguous Storage failure—the binary may already have been removed.
    try:
        cleaned = _delete_unreferenced_pdf_artifacts(
            pdf_id,
            record.get('storage_path'),
            strict=False,
        )
        if not cleaned:
            print(f'PDF artifact cleanup deferred for {pdf_id}', flush=True)
    except Exception as exc:
        print(f'PDF artifact cleanup deferred for {pdf_id}: {exc}', flush=True)
    return '', 204


@app.route('/api/pdfs/<pdf_id>/file', methods=['GET'])
@_studio_auth_required
def get_pdf_file(pdf_id):
    record = next((pdf for pdf in _load_pdfs() if pdf.get('id') == pdf_id), None)
    if not record:
        return jsonify({'error': 'Not found'}), 404
    return _pdf_file_gateway(record)


@app.route('/api/pdfs/<pdf_id>/reindex-source', methods=['GET'])
@_studio_auth_required
def get_pdf_reindex_source(pdf_id):
    """Return a fetchable binary URL without leaking PDF record internals."""
    record = next((pdf for pdf in _load_pdfs() if pdf.get('id') == pdf_id), None)
    if not record:
        return jsonify({'error': 'Not found'}), 404
    storage_path = record.get('storage_path') or ''
    if not _PDF_STORAGE_PATH_RE.fullmatch(storage_path):
        return jsonify({'error': 'PDF file is unavailable'}), 404

    if supabase:
        try:
            url = _pdf_signed_read_url(storage_path)
        except Exception as exc:
            print(f'PDF reindex source URL failed for {storage_path}: {exc}', flush=True)
            return jsonify({'error': 'PDF file is temporarily unavailable'}), 502
        payload = {'url': url, 'mode': 'supabase'}
    else:
        if not os.path.exists(_local_pdf_path(storage_path)):
            return jsonify({'error': 'PDF file is unavailable'}), 404
        payload = {'url': f'/api/pdfs/{pdf_id}/file', 'mode': 'local'}

    response = jsonify(payload)
    response.headers['Cache-Control'] = 'no-store, private'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.route('/api/visitor/pdfs/<pdf_id>/file', methods=['GET'])
@_viewer_auth_required
def get_visitor_pdf_file(pdf_id):
    record = next(
        (pdf for pdf in _visitor_visible_docs('pdf', _load_pdfs()) if pdf.get('id') == pdf_id),
        None,
    )
    if not record:
        return jsonify({'error': 'Not found'}), 404
    return _pdf_file_gateway(record)


@app.route('/api/auth/r-token', methods=['POST'])
def mint_r_token():
    body = request.get_json(silent=True) or {}
    password = (body.get('password') or '').strip()
    if not password:
        return jsonify({'error': 'password required'}), 400
    if not _verify_studio_password(password):
        return jsonify({'error': 'invalid password'}), 401
    token_id = uuid.uuid4().hex
    tokens = _load_r_tokens()
    tokens.append({
        'id': token_id,
        'created_at': datetime.utcnow().isoformat() + 'Z',
        'active': True,
    })
    _save_r_tokens(tokens)
    token = _r_token_serializer().dumps({'kind': 'r-token', 'token_id': token_id})
    return jsonify({'token': token})


@app.route('/api/reports/push', methods=['POST'])
@_r_token_required
def push_report():
    if 'html' not in request.files:
        return jsonify({'error': 'html file required'}), 400
    html_file = request.files['html']
    html_bytes = html_file.read()
    if len(html_bytes) > MAX_REPORT_HTML_BYTES:
        return jsonify({'error': f'html exceeds {MAX_REPORT_HTML_BYTES} bytes'}), 413
    try:
        html = html_bytes.decode('utf-8')
    except UnicodeDecodeError:
        return jsonify({'error': 'html must be utf-8'}), 400

    name = (request.form.get('name') or '').strip()
    path_hash = (request.form.get('path_hash') or '').strip()
    override_name = (request.form.get('override_name') or '').strip() or None
    if not name or not path_hash:
        return jsonify({'error': 'name and path_hash required'}), 400

    reports = _load_reports()
    existing = None
    if override_name:
        existing = next((r for r in reports if r.get('override_name') == override_name), None)
    if existing is None:
        existing = next(
            (r for r in reports if r.get('source_path_hash') == path_hash and not r.get('override_name')),
            None,
        )

    now = datetime.utcnow().isoformat() + 'Z'
    text = _text_from_report_html(html)

    if existing is None:
        report_id = uuid.uuid4().hex
        record = {
            'id': report_id,
            'name': name,
            'folder_id': None,
            'private': None,
            'source_path_hash': path_hash,
            'override_name': override_name,
            'created_at': now,
            'updated_at': now,
        }
        reports.append(record)
        created = True
        created_at = now
    else:
        report_id = existing['id']
        existing['name'] = name
        existing['updated_at'] = now
        if override_name:
            existing['override_name'] = override_name
        else:
            existing['source_path_hash'] = path_hash
        created = False
        created_at = existing.get('created_at', now)

    _save_reports(reports)
    _save_report(report_id, {
        'id': report_id,
        'name': name,
        'html': html,
        'text': text,
        'source_path_hash': path_hash,
        'override_name': override_name,
        'created_at': created_at,
        'updated_at': now,
    })
    return jsonify({'id': report_id, 'created': created, 'url': f'/reports/{report_id}'})


@app.route('/api/reports/<report_id>', methods=['GET'])
@_studio_auth_required
def get_report(report_id):
    record = next((r for r in _load_reports() if r.get('id') == report_id), None)
    if record is None:
        return jsonify({'error': 'not found'}), 404
    blob = _load_report(report_id) or {}
    return jsonify({**record, 'html': blob.get('html', '')})


@app.route('/api/reports/<report_id>', methods=['DELETE'])
@_studio_auth_required
def delete_report(report_id):
    reports = _load_reports()
    new_reports = [r for r in reports if r.get('id') != report_id]
    if len(new_reports) == len(reports):
        return jsonify({'error': 'not found'}), 404
    _save_reports(new_reports)
    _delete_report_files([report_id])
    return jsonify({'ok': True})


@app.route('/api/reports/<report_id>', methods=['PATCH'])
@_studio_auth_required
def patch_report(report_id):
    body = request.get_json(silent=True) or {}
    reports = _load_reports()
    record = next((r for r in reports if r.get('id') == report_id), None)
    if record is None:
        return jsonify({'error': 'not found'}), 404
    for field in ('name', 'folder_id', 'private'):
        if field in body:
            record[field] = body[field]
    record['updated_at'] = datetime.utcnow().isoformat() + 'Z'
    _save_reports(reports)
    blob = _load_report(report_id) or {}
    if 'name' in body:
        blob['name'] = body['name']
        blob['updated_at'] = record['updated_at']
        _save_report(report_id, blob)
    return jsonify(record)


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
@_serialize_pdf_mutation
def delete_folder(folder_id):
    ws = _get_workspace()
    folders = [dict(folder) for folder in ws.get('folders', [])]
    target = next((folder for folder in folders if folder['id'] == folder_id), None)
    if not target:
        return jsonify({'error': 'Not found'}), 404

    target_parent_id = target.get('parent_id')
    mode = (request.args.get('mode') or 'move').strip().lower()
    if mode not in {'move', 'delete'}:
        return jsonify({'error': 'Invalid delete mode'}), 400

    if mode == 'move':
        original_folders = [dict(folder) for folder in folders]
        remaining = [dict(folder) for folder in folders if folder['id'] != folder_id]
        docs_by_kind = {
            kind: load_docs()
            for kind, (load_docs, _save_docs, _strict_save_docs) in _doc_index_handlers().items()
        }
        moved_by_kind = {}
        for kind, docs in docs_by_kind.items():
            moved = [dict(doc) for doc in docs]
            changed = False
            for doc in moved:
                if doc.get('folder_id') == folder_id:
                    doc['folder_id'] = target_parent_id
                    changed = True
            if changed:
                moved_by_kind[kind] = moved
        _reparent_child_folders(folder_id, remaining, target_parent_id)
        try:
            for kind, moved in moved_by_kind.items():
                _doc_index_handlers()[kind][2](moved)
            ws['folders'] = remaining
            _save_workspace_strict(ws)
        except Exception as exc:
            print(f'Folder move failed for {folder_id}: {exc}', flush=True)
            ws['folders'] = original_folders
            try:
                _save_workspace_strict(ws)
            except Exception:
                pass
            for kind in moved_by_kind:
                try:
                    _doc_index_handlers()[kind][2](docs_by_kind[kind])
                except Exception:
                    pass
            return jsonify({'error': 'Could not move folder contents'}), 502
        return '', 204

    folder_ids = _folder_with_descendants(folder_id, folders)
    docs_by_kind = {
        kind: load_docs()
        for kind, (load_docs, _save_docs, _strict_save_docs) in _doc_index_handlers().items()
    }
    delete_ids = {
        kind: {
            doc.get('id') for doc in docs
            if doc.get('id') and doc.get('folder_id') in folder_ids
        }
        for kind, docs in docs_by_kind.items()
    }
    board_ids = delete_ids['board']
    sheet_ids = delete_ids['sheet']
    report_ids = delete_ids['report']
    pdf_ids = delete_ids['pdf']
    pdf_records = [pdf for pdf in docs_by_kind['pdf'] if pdf.get('id') in pdf_ids]
    upload_filenames = set()
    for board_id in board_ids:
        upload_filenames.update(_board_upload_filenames(board_id))

    remaining = [folder for folder in folders if folder['id'] not in folder_ids]
    try:
        for kind, (_load_docs, _save_docs, strict_save_docs) in _doc_index_handlers().items():
            ids = delete_ids[kind]
            if not ids:
                continue
            kept = [doc for doc in docs_by_kind[kind] if doc.get('id') not in ids]
            strict_save_docs(kept)

        ws['folders'] = remaining
        _save_workspace_strict(ws)
    except Exception as exc:
        # No document artifacts have been removed yet, so this metadata-only
        # phase can still be rolled back without resurrecting ghost records.
        print(f'Folder metadata deletion failed for {folder_id}: {exc}', flush=True)
        ws['folders'] = folders
        try:
            _save_workspace_strict(ws)
        except Exception:
            pass
        for kind, (_load_docs, _save_docs, strict_save_docs) in _doc_index_handlers().items():
            try:
                strict_save_docs(docs_by_kind[kind])
            except Exception:
                pass
        return jsonify({'error': 'Could not delete folder contents'}), 502

    # The visible deletion is now committed. Artifact deletion is irreversible,
    # so cleanup is best-effort and never rolls indexes back to records whose
    # binaries may already be gone. Remaining PDF objects are safe orphans and
    # the bounded upload-ticket prune will retry them later.
    for delete_files, ids, label in (
        (_delete_board_files, board_ids, 'board'),
        (_delete_sheet_files, sheet_ids, 'sheet'),
        (_delete_report_files, report_ids, 'report'),
    ):
        try:
            delete_files(ids)
        except Exception as exc:
            print(f'Folder {label} artifact cleanup failed for {folder_id}: {exc}', flush=True)
    for record in pdf_records:
        try:
            cleaned = _delete_unreferenced_pdf_artifacts(
                record['id'],
                record.get('storage_path'),
                strict=False,
            )
            if not cleaned:
                print(f'Folder PDF artifact cleanup deferred for {record["id"]}', flush=True)
        except Exception as exc:
            print(f'Folder PDF artifact cleanup deferred for {record["id"]}: {exc}', flush=True)

    drive_content_keys = {
        *(f'gdoc-{doc_id}' for doc_id in delete_ids['gdoc']),
        *(f'gsheet-{doc_id}' for doc_id in delete_ids['gsheet']),
    }
    if drive_content_keys:
        try:
            contents = _load_gdrive_contents()
            changed = False
            for key in drive_content_keys:
                if key in contents:
                    contents.pop(key, None)
                    changed = True
            if changed:
                _save_gdrive_contents(contents)
        except Exception as exc:
            print(f'Folder Drive-cache cleanup failed for {folder_id}: {exc}', flush=True)

    try:
        _cleanup_unreferenced_uploads(upload_filenames)
    except Exception as exc:
        print(f'Folder upload artifact cleanup failed for {folder_id}: {exc}', flush=True)
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
    ws = dict(ws)
    ws['folders'] = _visitor_visible_folders(ws)
    profile = _current_access_profile()
    if profile:
        ws['visitor_profile'] = {
            'id': profile.get('id'),
            'name': profile.get('name'),
        }
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


@app.route('/api/access-profiles', methods=['GET'])
@_studio_auth_required
def list_access_profiles():
    profiles = [_serialize_access_profile(profile) for profile in _load_access_profiles()]
    profiles.sort(key=lambda profile: profile.get('created_at', ''), reverse=True)
    return jsonify(profiles)


@app.route('/api/access-profiles', methods=['POST'])
@_studio_auth_required
def create_access_profile():
    data = request.json or {}
    password = data.get('password') or ''
    if len(password) < 6:
        return jsonify({'error': 'Visitor password must be at least 6 characters'}), 400
    if not _access_profile_password_storage_ready():
        return jsonify({'error': 'Set S8_ACCESS_PROFILE_PEPPER in Render before creating visitor access passwords.'}), 503
    now = datetime.now().isoformat()
    profile = {
        'id': str(uuid.uuid4())[:8],
        'name': (data.get('name') or 'Visitor access').strip() or 'Visitor access',
        'password_hash': '',
        'password_peppered': False,
        'active': True,
        'workspace': False,
        'folders': [],
        'docs': [],
        'created_at': now,
        'updated_at': now,
    }
    profile = _sanitize_access_profile_payload(data, existing=profile)
    profiles = _load_access_profiles()
    profiles.append(profile)
    _save_access_profiles(profiles)
    return jsonify(_serialize_access_profile(profile)), 201


@app.route('/api/access-profiles/<profile_id>', methods=['PATCH'])
@_studio_auth_required
def patch_access_profile(profile_id):
    data = request.json or {}
    profiles = _load_access_profiles()
    password = data.get('password')
    if isinstance(password, str) and password and len(password) < 6:
        return jsonify({'error': 'Visitor password must be at least 6 characters'}), 400
    if isinstance(password, str) and password and not _access_profile_password_storage_ready():
        return jsonify({'error': 'Set S8_ACCESS_PROFILE_PEPPER in Render before changing visitor access passwords.'}), 503
    for idx, profile in enumerate(profiles):
        if profile.get('id') != profile_id:
            continue
        updated = _sanitize_access_profile_payload(data, existing=profile)
        profiles[idx] = updated
        _save_access_profiles(profiles)
        return jsonify(_serialize_access_profile(updated))
    return jsonify({'error': 'Access profile not found'}), 404


@app.route('/api/access-profiles/<profile_id>', methods=['DELETE'])
@_studio_auth_required
def delete_access_profile(profile_id):
    profiles = _load_access_profiles()
    next_profiles = [profile for profile in profiles if profile.get('id') != profile_id]
    if len(next_profiles) == len(profiles):
        return jsonify({'error': 'Access profile not found'}), 404
    _save_access_profiles(next_profiles)
    return '', 204


@app.route('/api/shares', methods=['GET'])
@_studio_auth_required
def list_shares():
    return jsonify([])


@app.route('/api/shares', methods=['POST'])
@_studio_auth_required
def create_share():
    return jsonify({'error': 'Share links are disabled. Use visitor access passwords instead.'}), 410


@app.route('/api/shares/<share_id>', methods=['DELETE'])
@_studio_auth_required
def revoke_share(share_id):
    return jsonify({'error': 'Share links are disabled. Use visitor access passwords instead.'}), 410


@app.route('/api/share/<token>', methods=['GET'])
def share_by_token(token):
    return jsonify({'error': 'Share links are disabled. Use visitor access passwords instead.'}), 410


@app.route('/api/share/<token>/board/<board_id>', methods=['GET'])
def share_board(token, board_id):
    return jsonify({'error': 'Share links are disabled. Use visitor access passwords instead.'}), 410


@app.route('/api/share/<token>/sheet/<sheet_id>', methods=['GET'])
def share_sheet(token, sheet_id):
    return jsonify({'error': 'Share links are disabled. Use visitor access passwords instead.'}), 410


# ── Boards ───────────────────────────────────────────────────────────────────

@app.route('/api/boards', methods=['GET'])
@_studio_auth_required
def list_boards():
    return jsonify(_list_docs_sorted(_load_boards()))


@app.route('/api/visitor/boards', methods=['GET'])
@_viewer_auth_required
def list_visitor_boards():
    return jsonify(_list_docs_sorted(_load_boards(), visitor=True, kind='board'))


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
        board_id, kind='board', load_index=_load_boards, doc_file_fn=_board_file, default_payload={'snapshot': None}
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
    return jsonify(_list_docs_sorted(_load_sheets(), visitor=True, kind='sheet'))


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
        sheet_id, kind='sheet', load_index=_load_sheets, doc_file_fn=_sheet_file, default_payload={'data': []}
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
    if PRODUCTION:
        raise RuntimeError('FRONTEND_URL env var is required in production')
    return 'http://127.0.0.1:5173'


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

    # Granular consent: even when the auth URL asks for the full `auth/drive`
    # scope, Google's consent UI lets the user uncheck the "create/edit/delete
    # files" checkbox and still hit Allow. The resulting token can list and
    # read but POST /drive/v3/files returns 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT,
    # which surfaces in the UI as a silent empty-state on every new doc/sheet.
    # Reject here so the user sees an actionable error instead of a partial
    # success that breaks on the next create.
    granted = set((token_payload.get('scope') or '').split())
    if 'https://www.googleapis.com/auth/drive' not in granted:
        return redirect(f'{_frontend_origin()}/?google=error&reason=insufficient_scope')

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

    # Preserve drive_config (save root, mirror toggle, folder cache) and the
    # prior refresh_token across reconnect — they survive token rotation and
    # are user preferences, not auth state. Without this, any reconnect
    # silently resets the user's Drive save location to "My Drive root".
    prior = _load_google_token_record()
    record = {
        'connected': True,
        'email': email,
        'access_token': access_token,
        'token_expires_at': (datetime.now() + _timedelta(seconds=expires_in)).isoformat(),
        'connected_at': datetime.now().isoformat(),
    }
    if refresh_token:
        record['refresh_token'] = refresh_token
    elif prior.get('refresh_token'):
        # Re-auth without prompt=consent omits refresh_token; preserve the old one.
        record['refresh_token'] = prior['refresh_token']
    if prior.get('drive_config'):
        record['drive_config'] = prior['drive_config']
    _save_google_token_record(record)

    return redirect(f'{_frontend_origin()}/?google=connected')


@app.route('/api/google/disconnect', methods=['POST'])
@_studio_auth_required
def google_disconnect():
    # Clear auth tokens but keep drive_config so the user's save-location
    # preferences survive a disconnect/reconnect cycle.
    prior = _load_google_token_record()
    new_record = {'connected': False, 'email': None}
    if prior.get('drive_config'):
        new_record['drive_config'] = prior['drive_config']
    _save(GOOGLE_AUTH_FILE, new_record)
    return jsonify(_google_auth_state())


def _drive_config_response():
    config = _drive_get_config()
    return {
        'root_folder_id': config['root_folder_id'],
        'root_folder_name': config['root_folder_name'],
        'mirror_folders': config['mirror_folders'],
    }


@app.route('/api/google/config', methods=['GET'])
@_studio_auth_required
def google_drive_config_get():
    return jsonify(_drive_config_response())


@app.route('/api/google/config', methods=['PATCH'])
@_studio_auth_required
def google_drive_config_patch():
    data = request.json or {}
    updates = {}
    if 'root_folder_id' in data:
        access_token = _get_google_access_token()
        new_id = (data.get('root_folder_id') or '').strip() or None
        if new_id and access_token:
            meta = _drive_get_folder_meta(new_id, access_token)
            if not meta:
                return jsonify({'error': 'Could not access that Drive folder. Check the ID and permissions.'}), 400
            updates['root_folder_id'] = meta['id']
            updates['root_folder_name'] = meta['name']
        else:
            updates['root_folder_id'] = None
            updates['root_folder_name'] = 'My Drive'
        # Reset the mirror map whenever the root changes — old mappings point
        # at folders under a different root and would create cross-tree links.
        updates['folder_map'] = {}
    if 'mirror_folders' in data:
        updates['mirror_folders'] = bool(data.get('mirror_folders'))
    _drive_save_config(updates)
    return jsonify(_drive_config_response())


@app.route('/api/google/folders', methods=['GET'])
@_studio_auth_required
def google_drive_folders_list():
    access_token = _get_google_access_token()
    if not access_token:
        return jsonify({'error': 'Google account not connected'}), 400
    parent = (request.args.get('parent') or '').strip() or None
    folders = _drive_list_folders(parent, access_token)
    breadcrumb = [{'id': None, 'name': 'My Drive'}]
    if parent:
        meta = _drive_get_folder_meta(parent, access_token)
        if meta:
            breadcrumb.append({'id': meta['id'], 'name': meta['name']})
    return jsonify({'folders': folders, 'parent': parent, 'breadcrumb': breadcrumb})


def _drive_get_file_parents(file_id, access_token, timeout=15):
    params = _urllib_parse.urlencode({'fields': 'parents'})
    payload = _drive_api_get(
        f'https://www.googleapis.com/drive/v3/files/{file_id}?{params}',
        access_token, timeout,
    )
    if not payload:
        return None
    return payload.get('parents') or []


def _drive_move_file(file_id, new_parent_id, current_parents, access_token, timeout=15):
    """Move a Drive file by adjusting its parents. Drive's PATCH supports
    `addParents` + `removeParents` in one call. Returns True on success."""
    if not file_id:
        return False
    add_parents = new_parent_id or 'root'
    remove_parents = ','.join(p for p in (current_parents or []) if p != add_parents)
    if not remove_parents and add_parents in (current_parents or []):
        # Already in the right place — no-op success.
        return True
    params = {'addParents': add_parents}
    if remove_parents:
        params['removeParents'] = remove_parents
    url = f'https://www.googleapis.com/drive/v3/files/{file_id}?{_urllib_parse.urlencode(params)}'
    try:
        req = _urllib_request.Request(
            url, data=b'{}', method='PATCH',
            headers={'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'},
        )
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            return resp.status in (200, 204)
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Drive file move failed for {file_id}: {exc}', flush=True)
        return False


@app.route('/api/google/sync-existing', methods=['POST'])
@_studio_auth_required
def google_drive_sync_existing():
    """Move every linked Doc/Sheet into the Drive folder that mirrors its
    Station 8 folder (or to the configured save root if it's unfiled).
    No-op for items without a `drive_file_id` (e.g. URL-pasted imports
    where we don't own the file). Returns a per-item summary so the UI
    can show what happened."""
    access_token = _get_google_access_token()
    if not access_token:
        return jsonify({'error': 'Google account not connected'}), 400
    config = _drive_get_config()
    items = (
        [(item, 'gdoc') for item in _load_gdocs()]
        + [(item, 'gsheet') for item in _load_gsheets()]
    )
    moved = []
    skipped_no_drive_file = []
    failed = []
    for item, _kind in items:
        file_id = (item.get('drive_file_id') or '').strip()
        if not file_id:
            skipped_no_drive_file.append({'name': item.get('name'), 'reason': 'no linked Drive file'})
            continue
        s8_folder_id = item.get('folder_id')
        if config['mirror_folders'] and s8_folder_id:
            target_parent = _drive_ensure_mirror_folder(s8_folder_id, access_token)
        else:
            target_parent = config['root_folder_id']
        current_parents = _drive_get_file_parents(file_id, access_token) or []
        if _drive_move_file(file_id, target_parent, current_parents, access_token):
            moved.append({'name': item.get('name'), 'file_id': file_id})
        else:
            failed.append({'name': item.get('name'), 'file_id': file_id})
    return jsonify({
        'moved': moved,
        'skipped': skipped_no_drive_file,
        'failed': failed,
        'summary': {
            'moved': len(moved),
            'skipped': len(skipped_no_drive_file),
            'failed': len(failed),
            'total': len(items),
        },
    })


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
_DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'
_DRIVE_EDIT_URL = {
    'gdoc': 'https://docs.google.com/document/d/{id}/edit',
    'gsheet': 'https://docs.google.com/spreadsheets/d/{id}/edit',
}


def _drive_get_config():
    """Read the Drive save-location settings from google_auth.json. Defaults
    place new files at My Drive root with no folder mirroring."""
    record = _load_google_token_record()
    config = record.get('drive_config') or {}
    return {
        'root_folder_id': config.get('root_folder_id') or None,
        'root_folder_name': config.get('root_folder_name') or 'My Drive',
        'mirror_folders': bool(config.get('mirror_folders')),
        # s8_folder_id -> drive_folder_id, populated lazily as files are created
        'folder_map': dict(config.get('folder_map') or {}),
    }


def _drive_save_config(updates):
    record = _load_google_token_record()
    config = record.get('drive_config') or {}
    config.update(updates)
    record['drive_config'] = config
    _save_google_token_record(record)
    return _drive_get_config()


def _drive_api_get(url, access_token, timeout=15):
    try:
        req = _urllib_request.Request(
            url,
            headers={'Authorization': f'Bearer {access_token}'},
        )
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Drive GET failed ({url}): {exc}', flush=True)
        return None


def _drive_list_folders(parent_id, access_token, timeout=15):
    """List immediate folder children of the given parent. parent_id=None
    lists folders at the My Drive root."""
    parent_clause = f"'{parent_id}' in parents" if parent_id else "'root' in parents"
    query = f"{parent_clause} and mimeType = '{_DRIVE_FOLDER_MIME}' and trashed = false"
    params = _urllib_parse.urlencode({
        'q': query,
        'fields': 'files(id,name,parents)',
        'orderBy': 'name',
        'pageSize': 200,
    })
    payload = _drive_api_get(f'https://www.googleapis.com/drive/v3/files?{params}', access_token, timeout)
    if not payload:
        return []
    return [{'id': f.get('id'), 'name': f.get('name')} for f in payload.get('files') or [] if f.get('id')]


def _drive_get_folder_meta(folder_id, access_token, timeout=15):
    if not folder_id:
        return {'id': None, 'name': 'My Drive'}
    params = _urllib_parse.urlencode({'fields': 'id,name'})
    payload = _drive_api_get(
        f'https://www.googleapis.com/drive/v3/files/{folder_id}?{params}',
        access_token, timeout,
    )
    if not payload or not payload.get('id'):
        return None
    return {'id': payload['id'], 'name': payload.get('name') or 'Untitled folder'}


def _drive_create_folder(name, parent_id, access_token, timeout=15):
    body_dict = {'name': name, 'mimeType': _DRIVE_FOLDER_MIME}
    if parent_id:
        body_dict['parents'] = [parent_id]
    body = json.dumps(body_dict).encode('utf-8')
    try:
        req = _urllib_request.Request(
            'https://www.googleapis.com/drive/v3/files',
            data=body, method='POST',
            headers={'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'},
        )
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except (_urllib_error.URLError, _urllib_error.HTTPError, OSError, ValueError) as exc:
        print(f'Drive folder create failed: {exc}', flush=True)
        return None
    return payload.get('id')


def _drive_ensure_mirror_folder(s8_folder_id, access_token):
    """Walk the Station 8 folder chain from root → s8_folder_id, ensuring a
    matching Drive folder exists at each step under the configured save root.
    Returns the Drive folder id corresponding to s8_folder_id, or None if the
    operation can't be completed (no token, missing folder, API error)."""
    if not s8_folder_id:
        return None
    config = _drive_get_config()
    folder_map = config['folder_map']
    folders = _get_workspace().get('folders', [])
    by_id = {f['id']: f for f in folders}
    if s8_folder_id not in by_id:
        return None
    # Build the chain root-most first.
    chain = []
    current = s8_folder_id
    seen = set()
    while current and current not in seen:
        seen.add(current)
        node = by_id.get(current)
        if not node:
            return None
        chain.append(node)
        current = node.get('parent_id')
    chain.reverse()
    parent_drive_id = config['root_folder_id']
    map_dirty = False
    for node in chain:
        node_id = node['id']
        cached = folder_map.get(node_id)
        if cached:
            parent_drive_id = cached
            continue
        # Re-use a same-named folder if one already lives under the parent.
        existing = next(
            (f for f in _drive_list_folders(parent_drive_id, access_token) if f['name'] == node['name']),
            None,
        )
        if existing:
            new_id = existing['id']
        else:
            new_id = _drive_create_folder(node['name'], parent_drive_id, access_token)
        if not new_id:
            return None
        folder_map[node_id] = new_id
        map_dirty = True
        parent_drive_id = new_id
    if map_dirty:
        _drive_save_config({'folder_map': folder_map})
    return parent_drive_id


def _drive_resolve_parent_for_doc(s8_folder_id, access_token):
    """Decide which Drive folder a newly-created file should live in.
    Honors the 'mirror Station 8 folders' setting; otherwise falls back to
    the configured save root (or My Drive root when unset)."""
    config = _drive_get_config()
    if config['mirror_folders'] and s8_folder_id:
        mirrored = _drive_ensure_mirror_folder(s8_folder_id, access_token)
        if mirrored:
            return mirrored
    return config['root_folder_id']


def _create_drive_file(kind, name, parent_id=None, timeout=15):
    """Create a fresh Google Doc or Sheet in the connected user's Drive.
    Returns (file_id, embed_url) on success, (None, None) if not connected
    or the API call fails. parent_id places the file inside a specific Drive
    folder; None places it at My Drive root."""
    access_token = _get_google_access_token()
    if not access_token or kind not in _DRIVE_MIME:
        return None, None
    body_dict = {'name': name, 'mimeType': _DRIVE_MIME[kind]}
    if parent_id:
        body_dict['parents'] = [parent_id]
    body = json.dumps(body_dict).encode('utf-8')
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


def _create_drive_file_verbose(kind, name, parent_id=None, timeout=15):
    """Same wire call as `_create_drive_file` but returns the full failure
    detail (HTTP status + Google error body) instead of swallowing it. Used
    by `/api/google/diagnostics` so the actual reason a create is failing
    surfaces to the owner."""
    out = {
        'ok': False, 'file_id': None, 'embed_url': None,
        'status': None, 'error_body': None, 'exception': None,
        'parent_id': parent_id, 'kind': kind, 'name': name,
    }
    access_token = _get_google_access_token()
    if not access_token:
        out['exception'] = 'no_access_token'
        return out
    if kind not in _DRIVE_MIME:
        out['exception'] = f'bad_kind: {kind}'
        return out
    body_dict = {'name': name, 'mimeType': _DRIVE_MIME[kind]}
    if parent_id:
        body_dict['parents'] = [parent_id]
    body = json.dumps(body_dict).encode('utf-8')
    try:
        req = _urllib_request.Request(
            'https://www.googleapis.com/drive/v3/files',
            data=body, method='POST',
            headers={'Authorization': f'Bearer {access_token}', 'Content-Type': 'application/json'},
        )
        with _urllib_request.urlopen(req, timeout=timeout) as resp:
            out['status'] = resp.status
            payload = json.loads(resp.read().decode('utf-8'))
        file_id = payload.get('id')
        if file_id:
            out['ok'] = True
            out['file_id'] = file_id
            out['embed_url'] = _DRIVE_EDIT_URL[kind].format(id=file_id)
    except _urllib_error.HTTPError as exc:
        out['status'] = exc.code
        try:
            out['error_body'] = exc.read().decode('utf-8', errors='replace')[:2000]
        except Exception:
            out['error_body'] = '<unreadable>'
        out['exception'] = f'HTTPError: {exc}'
    except (_urllib_error.URLError, OSError, ValueError) as exc:
        out['exception'] = f'{type(exc).__name__}: {exc}'
    return out


@app.route('/api/google/diagnostics', methods=['GET'])
@_studio_auth_required
def google_diagnostics():
    """Owner-only deep probe of the Google integration. Captures the saved
    token-record shape (keys only, no secrets), confirms a fresh access
    token is obtainable, then attempts a real Drive file create against the
    saved `drive_config.root_folder_id` and trashes the probe file on success.
    Exists because `_create_drive_file` swallows HTTPError silently — without
    this endpoint, a broken `/api/gsheets` create is indistinguishable from
    a working one that just returned `embed_url: null`."""
    record = _load_google_token_record()
    drive_config = record.get('drive_config') or {}
    out = {
        'connected_flag': bool(record.get('connected')),
        'has_access_token': bool(record.get('access_token')),
        'has_refresh_token': bool(record.get('refresh_token')),
        'token_expires_at': record.get('token_expires_at'),
        'connected_at': record.get('connected_at'),
        'email': record.get('email'),
        'drive_config': {
            'root_folder_id': drive_config.get('root_folder_id'),
            'root_folder_name': drive_config.get('root_folder_name'),
            'mirror_folders': bool(drive_config.get('mirror_folders')),
            'folder_map_size': len(drive_config.get('folder_map') or {}),
        },
    }
    access_token = _get_google_access_token()
    out['access_token_obtainable'] = bool(access_token)
    if not access_token:
        out['verdict'] = 'no access token — saved refresh token is missing or rejected. Disconnect and re-link.'
        return jsonify(out)

    parent_id = drive_config.get('root_folder_id')
    probe = _create_drive_file_verbose('gsheet', '_station8_diagnostics_probe', parent_id=parent_id)
    out['probe'] = probe

    if probe.get('file_id'):
        out['probe_cleaned_up'] = _delete_drive_file(probe['file_id'])

    if probe.get('ok'):
        out['verdict'] = 'create succeeded — the create path works. If real /api/gsheets is still empty, the bug is in the call site (folder mirroring, share-public, or the save_fn).'
    else:
        out['verdict'] = (
            f"create failed (status={probe.get('status')}, "
            f"exception={probe.get('exception')}). "
            f"Google said: {probe.get('error_body')}"
        )
    return jsonify(out)


def _create_gdrive_doc(load_fn, save_fn, request_data, kind):
    name = (request_data.get('name') or 'Untitled').strip() or 'Untitled'
    folders = _get_workspace().get('folders', [])
    pasted_url = (request_data.get('embed_url') or '').strip() or None

    drive_file_id = (request_data.get('drive_file_id') or '').strip() or None
    embed_url = pasted_url

    # No URL pasted → create the file in Drive automatically (when connected)
    # and share it publicly so visitors can view the embed without a manual
    # share-all run.
    access_token = _get_google_access_token()
    if not embed_url and access_token:
        s8_folder_id = _normalize_folder_id(request_data.get('folder_id'), folders)
        parent_drive_id = _drive_resolve_parent_for_doc(s8_folder_id, access_token)
        new_id, new_url = _create_drive_file(kind, name, parent_id=parent_drive_id)
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
    return jsonify(_list_docs_sorted(_load_gdocs(), visitor=True, kind='gdoc'))


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
    for d in _visitor_visible_docs('gdoc', _load_gdocs()):
        if d['id'] == gdoc_id:
            return jsonify(d)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/gsheets', methods=['GET'])
@_studio_auth_required
def list_gsheets():
    return jsonify(_list_docs_sorted(_load_gsheets()))


@app.route('/api/visitor/gsheets', methods=['GET'])
@_viewer_auth_required
def list_visitor_gsheets():
    return jsonify(_list_docs_sorted(_load_gsheets(), visitor=True, kind='gsheet'))


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
    for d in _visitor_visible_docs('gsheet', _load_gsheets()):
        if d['id'] == gsheet_id:
            return jsonify(d)
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/reports', methods=['GET'])
@_studio_auth_required
def list_reports():
    return jsonify(_list_docs_sorted(_load_reports()))


@app.route('/api/visitor/reports', methods=['GET'])
@_viewer_auth_required
def list_visitor_reports():
    return jsonify(_list_docs_sorted(_load_reports(), visitor=True, kind='report'))


@app.route('/api/visitor/reports/<report_id>', methods=['GET'])
@_viewer_auth_required
def get_visitor_report(report_id):
    payload, error = _visitor_doc_load(
        report_id,
        kind='report',
        load_index=_load_reports,
        doc_file_fn=_report_file,
        default_payload={'html': ''},
    )
    if error:
        return error
    return jsonify({
        'id': report_id,
        'name': payload.get('name', ''),
        'html': payload.get('html', ''),
        'created_at': payload.get('created_at'),
        'updated_at': payload.get('updated_at'),
    })


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


class _ReportTextExtractor(_StdlibHTMLParser):
    """Walks a knitted HTML doc and accumulates visible body text.

    Skips <script>, <style>, and <head> contents so the search index
    isn't polluted with CSS rules, JS strings, or meta tags.
    """
    _SKIP_TAGS = frozenset({'script', 'style', 'head', 'title'})

    def __init__(self):
        super().__init__()
        self._depth_skip = 0
        self._chunks = []

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP_TAGS:
            self._depth_skip += 1

    def handle_endtag(self, tag):
        if tag in self._SKIP_TAGS and self._depth_skip > 0:
            self._depth_skip -= 1

    def handle_data(self, data):
        if self._depth_skip == 0:
            text = data.strip()
            if text:
                self._chunks.append(text)

    def text(self):
        return ' '.join(self._chunks)


def _text_from_report_html(html: str) -> str:
    if not html:
        return ''
    parser = _ReportTextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return ''
    return parser.text()


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


def _all_items(boards=None, sheets=None, gdocs=None, gsheets=None, reports=None, pdfs=None):
    board_items = boards if boards is not None else _load_boards()
    sheet_items = sheets if sheets is not None else _load_sheets()
    gdoc_items = gdocs if gdocs is not None else _load_gdocs()
    gsheet_items = gsheets if gsheets is not None else _load_gsheets()
    report_items = reports if reports is not None else _load_reports()
    pdf_items = pdfs if pdfs is not None else _load_pdfs()
    drive_contents = _load_gdrive_contents()

    # Index every doc's name + tags so searches like "test" surface docs whose
    # title or tag contains the term, even when the body never mentions it.
    for doc_type, items in (
        ('board', board_items), ('sheet', sheet_items),
        ('gdoc', gdoc_items),   ('gsheet', gsheet_items),
        ('report', report_items),
        ('pdf', pdf_items),
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
    for report in report_items:
        blob = _load(_report_file(report['id']), {}) or {}
        text = (blob.get('text') or '').strip()
        if not text:
            continue
        yield {
            'doc_type': 'report',
            'doc_id': report['id'],
            'doc_name': report.get('name') or '',
            'kind': 'report',
            'text': text,
        }
    for pdf in pdf_items:
        detail = _load_pdf_text(pdf['id']) or {}
        for page in detail.get('pages') or []:
            if not isinstance(page, dict):
                continue
            text = (page.get('text') or '').strip()
            if not text:
                continue
            try:
                page_number = int(page.get('page'))
            except (TypeError, ValueError):
                continue
            yield {
                'doc_type': 'pdf',
                'doc_id': pdf['id'],
                'doc_name': pdf.get('name') or '',
                'kind': 'pdf',
                'text': text,
                'page': page_number,
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


def _search_payload(boards=None, sheets=None, gdocs=None, gsheets=None, reports=None, pdfs=None):
    body = request.json or {}
    query = (body.get('query') or '').strip()
    if not query:
        return {'hits': []}

    items = list(_all_items(
        boards=boards,
        sheets=sheets,
        gdocs=gdocs,
        gsheets=gsheets,
        reports=reports,
        pdfs=pdfs,
    ))
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
                    'report': 'Report',
                    'pdf': 'PDF page',
                }.get(item['kind'], item['kind']),
                'score': combined,
                'shape_id': item.get('shape_id'),
                'page': item.get('page'),
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
    workspace = _get_workspace()
    docs_by_kind = {
        'board': _load_boards(),
        'sheet': _load_sheets(),
        'gdoc': _load_gdocs(),
        'gsheet': _load_gsheets(),
        'report': _load_reports(),
        'pdf': _load_pdfs(),
    }
    boards = _visitor_visible_docs('board', docs_by_kind['board'], workspace=workspace, docs_by_kind=docs_by_kind)
    sheets = _visitor_visible_docs('sheet', docs_by_kind['sheet'], workspace=workspace, docs_by_kind=docs_by_kind)
    gdocs = _visitor_visible_docs('gdoc', docs_by_kind['gdoc'], workspace=workspace, docs_by_kind=docs_by_kind)
    gsheets = _visitor_visible_docs('gsheet', docs_by_kind['gsheet'], workspace=workspace, docs_by_kind=docs_by_kind)
    reports = _visitor_visible_docs('report', docs_by_kind['report'], workspace=workspace, docs_by_kind=docs_by_kind)
    pdfs = _visitor_visible_docs('pdf', docs_by_kind['pdf'], workspace=workspace, docs_by_kind=docs_by_kind)
    return jsonify(_search_payload(
        boards=boards,
        sheets=sheets,
        gdocs=gdocs,
        gsheets=gsheets,
        reports=reports,
        pdfs=pdfs,
    ))


@app.route('/api/share/<token>/search', methods=['POST'])
def share_search(token):
    return jsonify({'error': 'Share links are disabled. Use visitor access passwords instead.'}), 410


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
