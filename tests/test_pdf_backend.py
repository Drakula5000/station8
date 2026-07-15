import io
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock


# Import the application with production services disabled. Each test then
# points every mutable path at its own temporary directory.
_IMPORT_ROOT = tempfile.mkdtemp(prefix='station8-pdf-tests-import-')
os.environ['S8_STORAGE_DIR'] = _IMPORT_ROOT
os.environ.pop('SUPABASE_URL', None)
os.environ.pop('SUPABASE_KEY', None)

import server  # noqa: E402


PDF_BYTES = b'%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'


class _FakePdfBucket:
    def __init__(self):
        self.signed_read_calls = []

    def list(self, _path=None, _options=None):
        return []

    def remove(self, _paths):
        return []

    def create_signed_upload_url(self, path):
        return {
            'signed_url': f'https://storage.example/upload/{path}?token=test',
            'token': 'test',
            'path': path,
        }

    def create_signed_url(self, *args):
        self.signed_read_calls.append(args)
        return {'signedURL': f'https://storage.example/read/{args[0]}?token=test'}


class _FakeStorage:
    def __init__(self, public=False):
        self.public = public
        self.file_size_limit = server.MAX_PDF_BYTES
        self.allowed_mime_types = list(server.PDF_BUCKET_MIME_TYPES)
        self.bucket = _FakePdfBucket()

    def get_bucket(self, _bucket_id):
        return {
            'public': self.public,
            'file_size_limit': self.file_size_limit,
            'allowed_mime_types': self.allowed_mime_types,
        }

    def create_bucket(self, _bucket_id, options=None):
        self.public = bool((options or {}).get('public'))
        self.file_size_limit = (options or {}).get('file_size_limit')
        self.allowed_mime_types = (options or {}).get('allowed_mime_types')
        return {'name': _bucket_id}

    def update_bucket(self, _bucket_id, options):
        self.public = bool(options.get('public'))
        self.file_size_limit = options.get('file_size_limit')
        self.allowed_mime_types = options.get('allowed_mime_types')
        return {'name': _bucket_id}

    def from_(self, _bucket_id):
        return self.bucket


class _FakeSupabase:
    def __init__(self, public=False, table_rows=None):
        self.storage = _FakeStorage(public=public)
        self.table_rows = [{'data': []}] if table_rows is None else table_rows

    def table(self, _table_name):
        return _FakeTableQuery(self.table_rows)


class _FakeTableQuery:
    def __init__(self, data):
        self.data = data

    def select(self, _columns):
        return self

    def eq(self, _column, _value):
        return self

    def execute(self):
        return self


class PdfBackendTest(unittest.TestCase):
    FILES = {
        'BOARDS_FILE': 'boards.json',
        'SHEETS_FILE': 'sheets.json',
        'GDOCS_FILE': 'gdocs.json',
        'GSHEETS_FILE': 'gsheets.json',
        'GOOGLE_AUTH_FILE': 'google_auth.json',
        'GDRIVE_CONTENTS_FILE': 'gdrive_contents.json',
        'OCR_FILE': 'ocr.json',
        'WORKSPACE_FILE': 'workspace.json',
        'ACCESS_PROFILES_FILE': 'access_profiles.json',
        'AUTH_FILE': 'auth.json',
        'REPORTS_FILE': 'reports.json',
        'R_TOKENS_FILE': 'r_tokens.json',
        'PDFS_FILE': 'pdfs.json',
    }

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='station8-pdf-test-')
        self.data_dir = os.path.join(self.tmp.name, 'data')
        self.pdf_dir = os.path.join(self.tmp.name, 'pdfs')
        self.uploads_dir = os.path.join(self.tmp.name, 'uploads')
        os.makedirs(self.data_dir)
        os.makedirs(self.pdf_dir)
        os.makedirs(self.uploads_dir)

        server.DATA_DIR = self.data_dir
        server.STORAGE_ROOT = self.tmp.name
        server.PDFS_DIR = self.pdf_dir
        server.UPLOADS_DIR = self.uploads_dir
        for attr, filename in self.FILES.items():
            setattr(server, attr, os.path.join(self.data_dir, filename))
        server.supabase = None
        server.SUPABASE_KEY = None
        server._pdf_bucket_ready_client_id = None
        server._pdf_bucket_ready_at = 0.0
        server._pdf_prune_offset = 0
        server._vectorizer = None
        server._corpus_texts = []
        server._corpus_vectors = None
        server.app.config.update(TESTING=True, SECRET_KEY='pdf-test-secret')
        self.client = server.app.test_client()
        server._save(server.WORKSPACE_FILE, {
            'name': 'Test workspace',
            'owner': '',
            'created_at': '2026-01-01T00:00:00',
            'folders': [],
        })

    def tearDown(self):
        server.supabase = None
        server.SUPABASE_KEY = None
        server._pdf_bucket_ready_client_id = None
        server._pdf_bucket_ready_at = 0.0
        server._pdf_prune_offset = 0
        self.tmp.cleanup()

    def login_owner(self, client=None):
        client = client or self.client
        with client.session_transaction() as sess:
            sess.clear()
            sess['studio_authed'] = True

    def login_visitor(self, profile_id=None):
        with self.client.session_transaction() as sess:
            sess.clear()
            sess['visitor_authed'] = True
            if profile_id:
                sess['visitor_profile_id'] = profile_id

    def request_and_upload(self, filename='paper.pdf', blob=PDF_BYTES, client=None):
        client = client or self.client
        ticket_response = client.post('/api/pdfs/upload-ticket', json={
            'filename': filename,
            'size_bytes': len(blob),
            'mime_type': 'application/pdf',
        })
        self.assertEqual(ticket_response.status_code, 201, ticket_response.get_data(as_text=True))
        ticket_data = ticket_response.get_json()
        self.assertEqual(ticket_data['mode'], 'local')
        self.assertEqual(ticket_data['upload_url'], f"/api/pdfs/upload/{ticket_data['ticket']}")
        upload_response = client.put(
            f"/api/pdfs/upload/{ticket_data['ticket']}",
            data={'file': (io.BytesIO(blob), filename)},
            content_type='multipart/form-data',
        )
        self.assertEqual(upload_response.status_code, 201, upload_response.get_data(as_text=True))
        return ticket_data['ticket']

    def complete(self, ticket, client=None, **overrides):
        client = client or self.client
        payload = {
            'ticket': ticket,
            'name': 'Research Paper',
            'folder_id': None,
            'page_count': 2,
            'pages': [
                {'page': 1, 'text': 'introductory material'},
                {'page': 2, 'text': 'distinctive quasar evidence'},
            ],
            'text_status': 'indexed',
            'text_chars': 49,
        }
        payload.update(overrides)
        return client.post('/api/pdfs/complete', json=payload)

    def seed_pdf(self, pdf_id, *, name, folder_id=None, private=None, text='seed text'):
        storage_path = f'{pdf_id}.pdf'
        record = {
            'id': pdf_id,
            'name': name,
            'tags': [],
            'folder_id': folder_id,
            'private': private,
            'original_filename': f'{name}.pdf',
            'storage_path': storage_path,
            'size_bytes': len(PDF_BYTES),
            'page_count': 1,
            'text_status': 'indexed' if text else 'no_text',
            'text_chars': len(text),
            'created_at': '2026-01-01T00:00:00Z',
            'updated_at': '2026-01-01T00:00:00Z',
        }
        with open(os.path.join(self.pdf_dir, storage_path), 'wb') as f:
            f.write(PDF_BYTES)
        server._save_pdf_text_strict(pdf_id, {
            'id': pdf_id,
            'pages': [{'page': 1, 'text': text}] if text else [],
            'text_status': record['text_status'],
            'text_chars': len(text),
        })
        return record

    def test_upload_ticket_requires_owner_and_validates_pdf_metadata(self):
        response = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'paper.pdf',
            'size_bytes': 10,
            'mime_type': 'application/pdf',
        })
        self.assertEqual(response.status_code, 401)

        self.login_owner()
        wrong_type = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'paper.txt',
            'size_bytes': 10,
            'mime_type': 'text/plain',
        })
        self.assertEqual(wrong_type.status_code, 400)
        too_large = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'paper.pdf',
            'size_bytes': server.MAX_PDF_BYTES + 1,
            'mime_type': 'application/pdf',
        })
        self.assertEqual(too_large.status_code, 413)

    def test_ticket_creation_prunes_only_stale_unreferenced_pdf_objects(self):
        self.login_owner()
        now = server.time.time()
        stale_id = '1' * 32
        fresh_id = '2' * 32
        referenced_id = '3' * 32
        stale_path = os.path.join(self.pdf_dir, f'{stale_id}.pdf')
        fresh_path = os.path.join(self.pdf_dir, f'{fresh_id}.pdf')
        referenced = self.seed_pdf(referenced_id, name='Referenced')
        server._save_pdfs([referenced])
        for path in (stale_path, fresh_path):
            with open(path, 'wb') as f:
                f.write(PDF_BYTES)
        old = now - server.PDF_UPLOAD_TICKET_TTL_SECONDS - 1
        os.utime(stale_path, (old, old))
        os.utime(os.path.join(self.pdf_dir, f'{referenced_id}.pdf'), (old, old))
        os.utime(fresh_path, (now, now))

        response = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'new.pdf',
            'size_bytes': len(PDF_BYTES),
            'mime_type': 'application/pdf',
        })
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertFalse(os.path.exists(stale_path))
        self.assertTrue(os.path.exists(fresh_path))
        self.assertTrue(os.path.exists(os.path.join(self.pdf_dir, f'{referenced_id}.pdf')))

    def test_completion_status_is_derived_from_normalized_text(self):
        self.login_owner()
        ticket = self.request_and_upload()
        response = self.complete(ticket, text_status='invented')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()['text_status'], 'indexed')

    def test_completion_only_accepts_an_explicit_current_text_index_version(self):
        self.login_owner()
        legacy_ticket = self.request_and_upload('legacy-client.pdf')
        legacy = self.complete(legacy_ticket)
        self.assertEqual(legacy.status_code, 201, legacy.get_data(as_text=True))
        self.assertEqual(
            legacy.get_json()['text_index_version'],
            server.PDF_LEGACY_TEXT_INDEX_VERSION,
        )
        self.assertEqual(
            server._load_pdf_text(legacy_ticket)['text_index_version'],
            server.PDF_LEGACY_TEXT_INDEX_VERSION,
        )

        current_ticket = self.request_and_upload('current-client.pdf')
        current = self.complete(
            current_ticket,
            text_index_version=server.PDF_TEXT_INDEX_VERSION,
        )
        self.assertEqual(current.status_code, 201, current.get_data(as_text=True))
        self.assertEqual(
            current.get_json()['text_index_version'],
            server.PDF_TEXT_INDEX_VERSION,
        )
        self.assertEqual(
            server._load_pdf_text(current_ticket)['text_index_version'],
            server.PDF_TEXT_INDEX_VERSION,
        )

        # A string from an unknown/cached client is not an exact protocol
        # marker and must remain eligible for a safe reindex.
        string_ticket = self.request_and_upload('string-version.pdf')
        string_version = self.complete(
            string_ticket,
            text_index_version=str(server.PDF_TEXT_INDEX_VERSION),
        )
        self.assertEqual(
            string_version.get_json()['text_index_version'],
            server.PDF_LEGACY_TEXT_INDEX_VERSION,
        )

    def test_missing_text_index_version_normalizes_as_legacy_in_record_detail_and_client(self):
        self.login_owner()
        pdf_id = '0' * 32
        record = self.seed_pdf(pdf_id, name='Unversioned PDF')
        record.pop('text_index_version', None)
        server._save(server.PDFS_FILE, [record])
        detail = server._load(server._pdf_file(pdf_id), {})
        detail.pop('text_index_version', None)
        server._save(server._pdf_file(pdf_id), detail)

        self.assertEqual(
            server._load_pdfs()[0]['text_index_version'],
            server.PDF_LEGACY_TEXT_INDEX_VERSION,
        )
        self.assertEqual(
            server._load_pdf_text(pdf_id)['text_index_version'],
            server.PDF_LEGACY_TEXT_INDEX_VERSION,
        )
        response = self.client.get(f'/api/pdfs/{pdf_id}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()['text_index_version'],
            server.PDF_LEGACY_TEXT_INDEX_VERSION,
        )

    def test_supabase_ticket_uses_dedicated_private_bucket_signed_url(self):
        self.login_owner()
        server.supabase = _FakeSupabase(public=True)
        server.SUPABASE_KEY = 'x.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x'
        response = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'paper.pdf',
            'size_bytes': len(PDF_BYTES),
            'mime_type': 'application/pdf',
        })
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload['mode'], 'supabase')
        self.assertTrue(payload['upload_url'].startswith('https://storage.example/upload/'))
        self.assertFalse(server.supabase.storage.public)
        self.assertEqual(server.supabase.storage.file_size_limit, server.MAX_PDF_BYTES)
        self.assertEqual(
            set(server.supabase.storage.allowed_mime_types),
            set(server.PDF_BUCKET_MIME_TYPES),
        )

    def test_pdf_storage_rejects_anon_supabase_key_with_actionable_error(self):
        self.login_owner()
        server.supabase = _FakeSupabase()
        server.SUPABASE_KEY = 'x.eyJyb2xlIjoiYW5vbiJ9.x'
        response = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'paper.pdf',
            'size_bytes': len(PDF_BYTES),
            'mime_type': 'application/pdf',
        })
        self.assertEqual(response.status_code, 503)
        self.assertIn('service_role', response.get_json()['error'])

    def test_supabase_file_gateway_uses_inline_signed_url_without_download_option(self):
        self.login_owner()
        pdf_id = '8' * 32
        record = self.seed_pdf(pdf_id, name='Inline Paper')
        server._save_pdfs([record])
        server.supabase = _FakeSupabase()
        server.SUPABASE_KEY = 'x.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x'

        with mock.patch.object(server, '_load_pdfs', return_value=[record]):
            response = self.client.get(f'/api/pdfs/{pdf_id}/file')

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.headers['Location'].startswith('https://storage.example/read/'))
        self.assertEqual(
            server.supabase.storage.bucket.signed_read_calls,
            [(record['storage_path'], server.PDF_READ_URL_TTL_SECONDS)],
        )

    def test_pdf_reindex_source_requires_owner_and_returns_private_local_url(self):
        pdf_id = 'c' * 32
        record = self.seed_pdf(pdf_id, name='Private Legacy Scan', private=True)
        server._save_pdfs([record])

        self.assertEqual(
            self.client.get(f'/api/pdfs/{pdf_id}/reindex-source').status_code,
            401,
        )
        self.login_visitor()
        self.assertEqual(
            self.client.get(f'/api/pdfs/{pdf_id}/reindex-source').status_code,
            401,
        )

        self.login_owner()
        response = self.client.get(f'/api/pdfs/{pdf_id}/reindex-source')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {
            'mode': 'local',
            'url': f'/api/pdfs/{pdf_id}/file',
        })
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertNotIn('storage_path', response.get_json())
        self.assertNotIn('original_filename', response.get_json())

    def test_pdf_reindex_source_returns_one_hour_supabase_signed_url(self):
        self.login_owner()
        pdf_id = 'd' * 32
        record = self.seed_pdf(pdf_id, name='Remote Legacy Scan')
        server._save_pdfs([record])
        server.supabase = _FakeSupabase()
        server.SUPABASE_KEY = 'x.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x'

        with mock.patch.object(server, '_load_pdfs', return_value=[record]):
            response = self.client.get(f'/api/pdfs/{pdf_id}/reindex-source')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload['mode'], 'supabase')
        self.assertTrue(payload['url'].startswith('https://storage.example/read/'))
        self.assertEqual(set(payload), {'mode', 'url'})
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertEqual(
            server.supabase.storage.bucket.signed_read_calls,
            [(record['storage_path'], server.PDF_READ_URL_TTL_SECONDS)],
        )

    def test_supabase_orphan_prune_refuses_ambiguous_empty_index_result(self):
        server.supabase = _FakeSupabase(table_rows=[])
        with mock.patch.object(server, '_delete_pdf_binary') as delete_binary:
            removed = server._prune_stale_pdf_objects()
        self.assertEqual(removed, 0)
        delete_binary.assert_not_called()

    def test_local_upload_rejects_spoofed_pdf_magic(self):
        self.login_owner()
        blob = b'not really a pdf'
        ticket = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'spoof.pdf',
            'size_bytes': len(blob),
            'mime_type': 'application/pdf',
        }).get_json()['ticket']
        response = self.client.put(
            f'/api/pdfs/upload/{ticket}',
            data={'file': (io.BytesIO(blob), 'spoof.pdf')},
            content_type='multipart/form-data',
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(os.path.exists(os.path.join(self.pdf_dir, f'{ticket}.pdf')))

    def test_oversized_stored_object_is_rejected_before_buffered_download(self):
        self.login_owner()
        ticket = self.request_and_upload()
        with (
            mock.patch.object(server, '_pdf_storage_size', return_value=server.MAX_PDF_BYTES + 1),
            mock.patch.object(server, '_pdf_storage_bytes') as download,
        ):
            response = self.complete(ticket)
        self.assertEqual(response.status_code, 413)
        download.assert_not_called()

    def test_upload_complete_search_page_and_file_gateway(self):
        self.login_owner()
        ticket = self.request_and_upload()
        response = self.complete(ticket)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        record = response.get_json()
        self.assertEqual(record['id'], ticket)
        self.assertEqual(record['page_count'], 2)
        self.assertNotIn('storage_path', record)
        self.assertNotIn('original_filename', record)
        self.assertEqual(server._load_pdf_text(ticket)['pages'][1]['page'], 2)

        listed = self.client.get('/api/pdfs').get_json()
        detail = self.client.get(f'/api/pdfs/{ticket}').get_json()
        updated = self.client.patch(
            f'/api/pdfs/{ticket}',
            json={'name': 'Updated Research Paper'},
        ).get_json()
        self.assertNotIn('storage_path', listed[0])
        self.assertNotIn('storage_path', detail)
        self.assertNotIn('storage_path', updated)
        self.assertNotIn('original_filename', listed[0])
        self.assertNotIn('original_filename', detail)
        self.assertNotIn('original_filename', updated)

        # Completing again is intentionally idempotent and must use the same
        # sanitized response shape even when a stale browser retries it.
        repeated = self.complete(ticket)
        self.assertEqual(repeated.status_code, 200)
        self.assertNotIn('storage_path', repeated.get_json())

        search = self.client.post('/api/search', json={'query': 'quasar'})
        self.assertEqual(search.status_code, 200)
        hit = next(hit for hit in search.get_json()['hits'] if hit['doc_id'] == ticket)
        self.assertEqual(hit['doc_type'], 'pdf')
        self.assertEqual(hit['source'], 'PDF page')
        self.assertEqual(hit['page'], 2)

        file_response = self.client.get(f'/api/pdfs/{ticket}/file')
        self.assertEqual(file_response.status_code, 200)
        self.assertEqual(file_response.data, PDF_BYTES)
        self.assertIn('no-store', file_response.headers['Cache-Control'])
        file_response.close()

    def test_pdf_text_reindex_requires_owner_authentication(self):
        pdf_id = '8' * 32
        record = self.seed_pdf(pdf_id, name='Legacy Scan', text='')
        server._save_pdfs([record])
        payload = {
            'page_count': 1,
            'pages': [{'page': 1, 'text': 'recognized text'}],
            'text_status': 'indexed',
        }

        response = self.client.put(f'/api/pdfs/{pdf_id}/text-index', json=payload)
        self.assertEqual(response.status_code, 401)

        self.login_visitor()
        response = self.client.put(f'/api/pdfs/{pdf_id}/text-index', json=payload)
        self.assertEqual(response.status_code, 401)

    def test_pdf_text_reindex_validates_pages_limits_and_stored_page_count(self):
        self.login_owner()
        pdf_id = '9' * 32
        record = self.seed_pdf(pdf_id, name='Legacy Scan', text='')
        server._save_pdfs([record])

        invalid_pages = self.client.put(
            f'/api/pdfs/{pdf_id}/text-index',
            json={'page_count': 1, 'pages': 'not-a-list'},
        )
        self.assertEqual(invalid_pages.status_code, 400)

        count_mismatch = self.client.put(
            f'/api/pdfs/{pdf_id}/text-index',
            json={
                'page_count': 2,
                'pages': [{'page': 2, 'text': 'text from a different PDF'}],
            },
        )
        self.assertEqual(count_mismatch.status_code, 400)
        self.assertIn('page count', count_mismatch.get_json()['error'].lower())

        oversized_page = self.client.put(
            f'/api/pdfs/{pdf_id}/text-index',
            json={
                'page_count': 1,
                'pages': [{'page': 1, 'text': 'x' * (server.MAX_PDF_PAGE_TEXT_CHARS + 1)}],
            },
        )
        self.assertEqual(oversized_page.status_code, 413)
        self.assertEqual(server._load_pdfs()[0]['text_status'], 'no_text')
        self.assertEqual(server._load_pdf_text(pdf_id)['pages'], [])

    def test_pdf_text_reindex_enforces_total_and_duplicate_limits_and_derives_status(self):
        self.login_owner()
        pdf_id = '3' * 32
        record = self.seed_pdf(pdf_id, name='Boundary Scan', text='')
        record['page_count'] = 2
        server._save_pdfs([record])

        # Use a compact limit in this endpoint-level boundary test; the
        # production 2,000,000-character value is exercised by the frontend
        # index builder without constructing multi-megabyte HTTP payloads here.
        with mock.patch.object(server, 'MAX_PDF_TEXT_CHARS', 10):
            at_limit = self.client.put(
                f'/api/pdfs/{pdf_id}/text-index',
                json={
                    'page_count': 2,
                    'pages': [
                        {'page': 1, 'text': '12345'},
                        {'page': 2, 'text': '67890'},
                    ],
                    # Non-empty normalized text must override a false no-text
                    # claim from the browser.
                    'text_status': 'no_text',
                },
            )
            self.assertEqual(at_limit.status_code, 200, at_limit.get_data(as_text=True))
            self.assertEqual(at_limit.get_json()['text_chars'], 10)
            self.assertEqual(at_limit.get_json()['text_status'], 'indexed')

            over_limit = self.client.put(
                f'/api/pdfs/{pdf_id}/text-index',
                json={
                    'page_count': 2,
                    'pages': [
                        {'page': 1, 'text': '12345'},
                        {'page': 2, 'text': '678901'},
                    ],
                },
            )
            self.assertEqual(over_limit.status_code, 413)

        duplicate_page = self.client.put(
            f'/api/pdfs/{pdf_id}/text-index',
            json={
                'page_count': 2,
                'pages': [
                    {'page': 1, 'text': 'first'},
                    {'page': 1, 'text': 'duplicate'},
                ],
            },
        )
        self.assertEqual(duplicate_page.status_code, 400)
        self.assertIn('duplicate', duplicate_page.get_json()['error'].lower())

        empty_index = self.client.put(
            f'/api/pdfs/{pdf_id}/text-index',
            json={
                'page_count': 2,
                'pages': [],
                # Empty normalized text must override a false indexed claim.
                'text_status': 'truncated',
            },
        )
        self.assertEqual(empty_index.status_code, 200, empty_index.get_data(as_text=True))
        self.assertEqual(empty_index.get_json()['text_chars'], 0)
        self.assertEqual(empty_index.get_json()['text_status'], 'no_text')
        self.assertEqual(server._load_pdf_text(pdf_id)['pages'], [])

    def test_pdf_text_reindex_indexes_legacy_scan_and_searches_exact_page(self):
        self.login_owner()
        pdf_id = 'a' * 32
        record = self.seed_pdf(pdf_id, name='Legacy Scan', text='')
        record['page_count'] = 3
        server._save_pdfs([record])
        recognized = 'OCR recovered distinctive magnetar observations'

        response = self.client.put(
            f'/api/pdfs/{pdf_id}/text-index',
            json={
                'page_count': 3,
                'pages': [{'page': 2, 'text': recognized}],
                'text_status': 'indexed',
                # The server must compute this rather than trust the browser.
                'text_chars': 1,
                # Replacement is authoritative even if a stale caller sends
                # the wrong marker.
                'text_index_version': 0,
            },
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        updated = response.get_json()
        self.assertEqual(updated['page_count'], 3)
        self.assertEqual(updated['text_status'], 'indexed')
        self.assertEqual(updated['text_chars'], len(recognized))
        self.assertEqual(updated['text_index_version'], server.PDF_TEXT_INDEX_VERSION)
        self.assertEqual(updated['created_at'], record['created_at'])
        self.assertNotEqual(updated['updated_at'], record['updated_at'])
        self.assertNotIn('storage_path', updated)
        self.assertNotIn('original_filename', updated)

        detail = server._load_pdf_text(pdf_id)
        self.assertEqual(detail['pages'], [{'page': 2, 'text': recognized}])
        self.assertEqual(detail['text_status'], 'indexed')
        self.assertEqual(detail['text_chars'], len(recognized))
        self.assertEqual(detail['text_index_version'], server.PDF_TEXT_INDEX_VERSION)
        self.assertEqual(detail['created_at'], record['created_at'])
        self.assertEqual(detail['updated_at'], updated['updated_at'])

        search = self.client.post('/api/search', json={'query': 'magnetar'})
        self.assertEqual(search.status_code, 200)
        hit = next(hit for hit in search.get_json()['hits'] if hit['doc_id'] == pdf_id)
        self.assertEqual(hit['doc_type'], 'pdf')
        self.assertEqual(hit['source'], 'PDF page')
        self.assertEqual(hit['page'], 2)

    def test_pdf_text_reindex_persistence_failure_rolls_back_record_and_detail(self):
        self.login_owner()
        pdf_id = 'b' * 32
        record = self.seed_pdf(pdf_id, name='Legacy Scan', text='')
        server._save_pdfs([record])
        original_record = server._load_pdfs()[0]
        original_detail = server._load_pdf_text(pdf_id)
        original_save = server._save_pdfs_strict
        calls = 0

        def fail_once(pdfs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OSError('disk full')
            return original_save(pdfs)

        with mock.patch.object(server, '_save_pdfs_strict', side_effect=fail_once):
            response = self.client.put(
                f'/api/pdfs/{pdf_id}/text-index',
                json={
                    'page_count': 1,
                    'pages': [{'page': 1, 'text': 'new OCR text'}],
                    'text_status': 'indexed',
                },
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(calls, 2)
        self.assertEqual(server._load_pdfs()[0], original_record)
        self.assertEqual(server._load_pdf_text(pdf_id), original_detail)

    def test_concurrent_completions_preserve_both_pdf_index_records(self):
        client_a = server.app.test_client()
        client_b = server.app.test_client()
        self.login_owner(client_a)
        self.login_owner(client_b)
        ticket_a = self.request_and_upload('alpha.pdf', client=client_a)
        ticket_b = self.request_and_upload('beta.pdf', client=client_b)

        original_save_text = server._save_pdf_text_strict
        call_lock = threading.Lock()
        second_entered = threading.Event()
        call_count = 0

        def controlled_save_text(pdf_id, data):
            nonlocal call_count
            with call_lock:
                call_count += 1
                position = call_count
            if position == 1:
                # Without route serialization the second completion enters,
                # proving both already loaded the same old index snapshot.
                second_entered.wait(0.25)
            else:
                second_entered.set()
            return original_save_text(pdf_id, data)

        start = threading.Barrier(2)

        def finish(client, ticket):
            start.wait()
            return self.complete(ticket, client=client)

        with mock.patch.object(server, '_save_pdf_text_strict', side_effect=controlled_save_text):
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(
                    lambda args: finish(*args),
                    ((client_a, ticket_a), (client_b, ticket_b)),
                ))

        self.assertEqual([response.status_code for response in responses], [201, 201])
        self.assertEqual({pdf['id'] for pdf in server._load_pdfs()}, {ticket_a, ticket_b})

    def test_completion_persistence_failure_rolls_back_binary_text_and_ticket(self):
        self.login_owner()
        ticket = self.request_and_upload()
        with mock.patch.object(server, '_save_pdfs_strict', side_effect=OSError('disk full')):
            response = self.complete(ticket)
        self.assertEqual(response.status_code, 502)
        self.assertFalse(os.path.exists(os.path.join(self.pdf_dir, f'{ticket}.pdf')))
        self.assertIsNone(server._load_pdf_text(ticket))
        self.assertEqual(server._load_pdfs(), [])
        cleanup = self.client.delete('/api/pdfs/upload-ticket', json={'ticket': ticket})
        self.assertEqual(cleanup.status_code, 204)

    def test_ambiguous_committed_index_failure_retains_artifacts_for_idempotent_retry(self):
        self.login_owner()
        ticket = self.request_and_upload()
        original_save = server._save_pdfs_strict
        calls = 0

        def commit_then_lose_responses(pdfs):
            nonlocal calls
            calls += 1
            if calls == 1:
                original_save(pdfs)
                raise OSError('commit response lost')
            raise OSError('rollback response lost')

        with mock.patch.object(
            server,
            '_save_pdfs_strict',
            side_effect=commit_then_lose_responses,
        ):
            response = self.complete(ticket)

        self.assertEqual(response.status_code, 502)
        self.assertTrue(os.path.exists(os.path.join(self.pdf_dir, f'{ticket}.pdf')))
        self.assertIsNotNone(server._load_pdf_text(ticket))
        self.assertIn(ticket, {pdf['id'] for pdf in server._load_pdfs()})
        with self.client.session_transaction() as sess:
            self.assertIn(ticket, sess[server.PDF_UPLOAD_TICKETS_SESSION_KEY])

        # This mirrors the frontend's best-effort cleanup after any failed
        # completion response. The authoritative index wins, so the binary is
        # preserved even though the browser received a 502.
        cleanup = self.client.delete('/api/pdfs/upload-ticket', json={'ticket': ticket})
        self.assertEqual(cleanup.status_code, 204)
        self.assertTrue(os.path.exists(os.path.join(self.pdf_dir, f'{ticket}.pdf')))

        retry = self.complete(ticket)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.get_json()['id'], ticket)
        self.assertTrue(os.path.exists(os.path.join(self.pdf_dir, f'{ticket}.pdf')))

    def test_upload_ticket_cleanup_is_idempotent(self):
        self.login_owner()
        ticket = self.request_and_upload()
        first = self.client.delete('/api/pdfs/upload-ticket', json={'ticket': ticket})
        second = self.client.delete('/api/pdfs/upload-ticket', json={'ticket': ticket})
        self.assertEqual(first.status_code, 204)
        self.assertEqual(second.status_code, 204)
        self.assertFalse(os.path.exists(os.path.join(self.pdf_dir, f'{ticket}.pdf')))

    def test_failed_text_cleanup_keeps_ticket_retryable(self):
        self.login_owner()
        ticket = self.request_and_upload()
        with mock.patch.object(server, '_delete_json_blob', return_value=False):
            response = self.complete(ticket, pages='invalid')
        self.assertEqual(response.status_code, 400)
        with self.client.session_transaction() as sess:
            self.assertIn(ticket, sess[server.PDF_UPLOAD_TICKETS_SESSION_KEY])

        cleanup = self.client.delete('/api/pdfs/upload-ticket', json={'ticket': ticket})
        self.assertEqual(cleanup.status_code, 204)
        with self.client.session_transaction() as sess:
            self.assertNotIn(ticket, sess[server.PDF_UPLOAD_TICKETS_SESSION_KEY])

    def test_stale_cleanup_ticket_never_deletes_a_completed_pdf(self):
        self.login_owner()
        ticket = self.request_and_upload()
        with self.client.session_transaction() as sess:
            stale_ticket = dict(sess[server.PDF_UPLOAD_TICKETS_SESSION_KEY][ticket])
        self.assertEqual(self.complete(ticket).status_code, 201)

        # Simulate a completion response whose Set-Cookie never reached the
        # browser, followed by the frontend's best-effort cleanup request.
        with self.client.session_transaction() as sess:
            sess[server.PDF_UPLOAD_TICKETS_SESSION_KEY] = {ticket: stale_ticket}
        cleanup = self.client.delete('/api/pdfs/upload-ticket', json={'ticket': ticket})
        self.assertEqual(cleanup.status_code, 204)
        self.assertTrue(os.path.exists(os.path.join(self.pdf_dir, f'{ticket}.pdf')))
        self.assertEqual(server._load_pdfs()[0]['id'], ticket)

    def test_private_pdf_is_hidden_from_visitor_list_detail_file_and_search(self):
        self.login_owner()
        ticket = self.request_and_upload()
        complete = self.complete(ticket, private=True)
        self.assertEqual(complete.status_code, 201)

        self.login_visitor()
        self.assertEqual(self.client.get('/api/visitor/pdfs').get_json(), [])
        self.assertEqual(self.client.get(f'/api/visitor/pdfs/{ticket}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/visitor/pdfs/{ticket}/file').status_code, 404)
        hits = self.client.post('/api/visitor/search', json={'query': 'quasar'}).get_json()['hits']
        self.assertFalse(any(hit['doc_id'] == ticket for hit in hits))

    def test_renamed_visitor_pdf_never_exposes_original_filename(self):
        self.login_owner()
        ticket = self.request_and_upload(filename='sensitive-working-name.pdf')
        self.assertEqual(self.complete(ticket).status_code, 201)
        self.assertEqual(
            self.client.patch(f'/api/pdfs/{ticket}', json={'name': 'Published title'}).status_code,
            200,
        )

        self.login_visitor()
        listed = self.client.get('/api/visitor/pdfs').get_json()
        detail = self.client.get(f'/api/visitor/pdfs/{ticket}').get_json()
        file_response = self.client.get(f'/api/visitor/pdfs/{ticket}/file')
        self.assertEqual(listed[0]['name'], 'Published title')
        self.assertEqual(detail['name'], 'Published title')
        self.assertNotIn('original_filename', listed[0])
        self.assertNotIn('original_filename', detail)
        disposition = file_response.headers.get('Content-Disposition', '')
        self.assertIn('Published title.pdf', disposition)
        self.assertNotIn('sensitive-working-name', disposition)
        file_response.close()

    def test_access_profile_can_grant_one_explicit_pdf_without_leaking_another(self):
        allowed_id = 'a' * 32
        denied_id = 'b' * 32
        allowed = self.seed_pdf(allowed_id, name='Allowed', text='allowed nebula phrase')
        denied = self.seed_pdf(denied_id, name='Denied', text='classified pulsar phrase')
        server._save_pdfs([allowed, denied])
        server._save_access_profiles([{
            'id': 'profile1',
            'name': 'PDF access',
            'active': True,
            'workspace': False,
            'folders': [],
            'docs': [{'type': 'pdf', 'id': allowed_id}],
            'created_at': '2026-01-01T00:00:00',
            'updated_at': '2026-01-01T00:00:00',
        }])
        self.login_visitor('profile1')

        listed = self.client.get('/api/visitor/pdfs').get_json()
        self.assertEqual([item['id'] for item in listed], [allowed_id])
        allowed_hits = self.client.post('/api/visitor/search', json={'query': 'nebula'}).get_json()['hits']
        denied_hits = self.client.post('/api/visitor/search', json={'query': 'pulsar'}).get_json()['hits']
        self.assertTrue(any(hit['doc_id'] == allowed_id for hit in allowed_hits))
        self.assertFalse(any(hit['doc_id'] == denied_id for hit in denied_hits))

    def test_folder_move_reparents_pdf_gdoc_and_gsheet_to_parent(self):
        self.login_owner()
        folders = [
            {'id': 'parent', 'name': 'Parent', 'parent_id': None, 'created_at': '2026-01-01'},
            {'id': 'child', 'name': 'Child', 'parent_id': 'parent', 'created_at': '2026-01-01'},
        ]
        workspace = server._get_workspace()
        workspace['folders'] = folders
        server._save(server.WORKSPACE_FILE, workspace)
        pdf = self.seed_pdf('c' * 32, name='PDF', folder_id='child')
        server._save_pdfs([pdf])
        server._save_gdocs([{'id': 'gdoc1', 'name': 'Doc', 'folder_id': 'child'}])
        server._save_gsheets([{'id': 'gsheet1', 'name': 'Sheet', 'folder_id': 'child'}])

        response = self.client.delete('/api/folders/child?mode=move')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(server._load_pdfs()[0]['folder_id'], 'parent')
        self.assertEqual(server._load_gdocs()[0]['folder_id'], 'parent')
        self.assertEqual(server._load_gsheets()[0]['folder_id'], 'parent')

    def test_folder_move_strict_failure_keeps_original_hierarchy(self):
        self.login_owner()
        workspace = server._get_workspace()
        workspace['folders'] = [
            {'id': 'child', 'name': 'Child', 'parent_id': None, 'created_at': '2026-01-01'},
        ]
        server._save(server.WORKSPACE_FILE, workspace)
        pdf = self.seed_pdf('6' * 32, name='PDF', folder_id='child')
        server._save_pdfs([pdf])
        original_strict_save = server._save_pdfs_strict
        failed = False

        def fail_once(pdfs):
            nonlocal failed
            if not failed:
                failed = True
                raise OSError('remote write failed')
            return original_strict_save(pdfs)

        with mock.patch.object(server, '_save_pdfs_strict', side_effect=fail_once):
            response = self.client.delete('/api/folders/child?mode=move')

        self.assertEqual(response.status_code, 502)
        self.assertEqual(server._load_pdfs()[0]['folder_id'], 'child')
        self.assertIn('child', {folder['id'] for folder in server._get_workspace()['folders']})

    def test_folder_delete_cascades_pdf_and_google_indexes_but_preserves_outside_pdf(self):
        self.login_owner()
        folders = [
            {'id': 'doomed', 'name': 'Doomed', 'parent_id': None, 'created_at': '2026-01-01'},
            {'id': 'nested', 'name': 'Nested', 'parent_id': 'doomed', 'created_at': '2026-01-01'},
            {'id': 'safe', 'name': 'Safe', 'parent_id': None, 'created_at': '2026-01-01'},
        ]
        workspace = server._get_workspace()
        workspace['folders'] = folders
        server._save(server.WORKSPACE_FILE, workspace)
        doomed_id = 'd' * 32
        safe_id = 'e' * 32
        doomed = self.seed_pdf(doomed_id, name='Doomed PDF', folder_id='nested')
        safe = self.seed_pdf(safe_id, name='Safe PDF', folder_id='safe')
        server._save_pdfs([doomed, safe])
        server._save_gdocs([{'id': 'gdoc1', 'name': 'Doc', 'folder_id': 'nested'}])
        server._save_gsheets([{'id': 'gsheet1', 'name': 'Sheet', 'folder_id': 'doomed'}])
        server._save_gdrive_contents({
            'gdoc-gdoc1': {'text': 'doc text'},
            'gsheet-gsheet1': {'text': 'sheet text'},
        })

        response = self.client.delete('/api/folders/doomed?mode=delete')
        self.assertEqual(response.status_code, 204, response.get_data(as_text=True))
        self.assertEqual([item['id'] for item in server._load_pdfs()], [safe_id])
        self.assertFalse(os.path.exists(os.path.join(self.pdf_dir, f'{doomed_id}.pdf')))
        self.assertIsNone(server._load_pdf_text(doomed_id))
        self.assertTrue(os.path.exists(os.path.join(self.pdf_dir, f'{safe_id}.pdf')))
        self.assertEqual(server._load_gdocs(), [])
        self.assertEqual(server._load_gsheets(), [])
        self.assertEqual(server._load_gdrive_contents(), {})

    def test_folder_delete_never_restores_index_after_partial_binary_cleanup(self):
        self.login_owner()
        workspace = server._get_workspace()
        workspace['folders'] = [
            {'id': 'doomed', 'name': 'Doomed', 'parent_id': None, 'created_at': '2026-01-01'},
        ]
        server._save(server.WORKSPACE_FILE, workspace)
        first = self.seed_pdf('4' * 32, name='First', folder_id='doomed')
        second = self.seed_pdf('5' * 32, name='Second', folder_id='doomed')
        server._save_pdfs([first, second])
        calls = 0

        def partial_binary_cleanup(storage_path, *, strict=False):
            nonlocal calls
            calls += 1
            if calls == 1:
                os.remove(os.path.join(self.pdf_dir, storage_path))
                return True
            return False

        with mock.patch.object(server, '_delete_pdf_binary', side_effect=partial_binary_cleanup):
            response = self.client.delete('/api/folders/doomed?mode=delete')

        self.assertEqual(response.status_code, 204)
        self.assertEqual(server._load_pdfs(), [])
        self.assertFalse(os.path.exists(os.path.join(self.pdf_dir, first['storage_path'])))
        self.assertTrue(os.path.exists(os.path.join(self.pdf_dir, second['storage_path'])))
        self.assertNotIn('doomed', {folder['id'] for folder in server._get_workspace()['folders']})

    def test_owner_delete_removes_pdf_index_text_and_binary(self):
        self.login_owner()
        pdf_id = 'f' * 32
        record = self.seed_pdf(pdf_id, name='Delete Me')
        server._save_pdfs([record])
        response = self.client.delete(f'/api/pdfs/{pdf_id}')
        self.assertEqual(response.status_code, 204, response.get_data(as_text=True))
        self.assertEqual(server._load_pdfs(), [])
        self.assertIsNone(server._load_pdf_text(pdf_id))
        self.assertFalse(os.path.exists(os.path.join(self.pdf_dir, f'{pdf_id}.pdf')))

    def test_owner_delete_never_resurrects_after_ambiguous_binary_failure(self):
        self.login_owner()
        pdf_id = '7' * 32
        record = self.seed_pdf(pdf_id, name='Ambiguous Delete')
        server._save_pdfs([record])

        def delete_then_lose_response(storage_path, *, strict=False):
            os.remove(os.path.join(self.pdf_dir, storage_path))
            raise OSError('storage response lost')

        with mock.patch.object(server, '_delete_pdf_binary', side_effect=delete_then_lose_response):
            response = self.client.delete(f'/api/pdfs/{pdf_id}')

        self.assertEqual(response.status_code, 204)
        self.assertEqual(server._load_pdfs(), [])
        self.assertIsNone(server._load_pdf_text(pdf_id))
        self.assertFalse(os.path.exists(os.path.join(self.pdf_dir, record['storage_path'])))


if __name__ == '__main__':
    unittest.main()
