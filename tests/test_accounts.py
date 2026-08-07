import os
import tempfile
import unittest

# Import with production services disabled. Individual tests replace every
# mutable path with their own temporary directory below.
_IMPORT_ROOT = tempfile.mkdtemp(prefix='station8-account-tests-import-')
os.environ['S8_STORAGE_DIR'] = _IMPORT_ROOT
os.environ.pop('SUPABASE_URL', None)
os.environ.pop('SUPABASE_KEY', None)
os.environ.pop('S8_SECONDARY_PASSWORD', None)

import server  # noqa: E402


class AccountIsolationTest(unittest.TestCase):
    FILES = {
        'BOARDS_FILE': 'boards.json',
        'SHEETS_FILE': 'sheets.json',
        'GDOCS_FILE': 'gdocs.json',
        'GSHEETS_FILE': 'gsheets.json',
        'GSLIDES_FILE': 'gslides.json',
        'GOOGLE_AUTH_FILE': 'google_auth.json',
        'GDRIVE_CONTENTS_FILE': 'gdrive_contents.json',
        'OCR_FILE': 'ocr.json',
        'WORKSPACE_FILE': 'workspace.json',
        'ACCESS_PROFILES_FILE': 'access_profiles.json',
        'AUTH_FILE': 'auth.json',
        'ACCOUNTS_FILE': 'accounts.json',
        'REPORTS_FILE': 'reports.json',
        'R_TOKENS_FILE': 'r_tokens.json',
        'PDFS_FILE': 'pdfs.json',
    }

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='station8-account-test-')
        self.data_dir = os.path.join(self.tmp.name, 'data')
        self.pdf_dir = os.path.join(self.tmp.name, 'pdfs')
        self.upload_dir = os.path.join(self.tmp.name, 'uploads')
        os.makedirs(self.data_dir)
        os.makedirs(self.pdf_dir)
        os.makedirs(self.upload_dir)

        server.DATA_DIR = self.data_dir
        server.STORAGE_ROOT = self.tmp.name
        server.PDFS_DIR = self.pdf_dir
        server.UPLOADS_DIR = self.upload_dir
        for attr, filename in self.FILES.items():
            setattr(server, attr, os.path.join(self.data_dir, filename))
        server.supabase = None
        server.SUPABASE_KEY = None
        os.environ.pop(server.SECONDARY_ACCOUNT_PASSWORD_ENV, None)
        server._login_attempts.clear()
        server.app.config.update(TESTING=True, SECRET_KEY='account-test-secret')
        self.client = server.app.test_client()

    def tearDown(self):
        server.supabase = None
        server.SUPABASE_KEY = None
        os.environ.pop(server.SECONDARY_ACCOUNT_PASSWORD_ENV, None)
        server._login_attempts.clear()
        self.tmp.cleanup()

    def login(self, password):
        return self.client.post('/api/auth/login', json={'password': password})

    def create_secondary_account(self, login='secondary-user', password='correct horse battery'):
        response = self.client.post('/api/accounts', json={
            'login': login,
            'password': password,
        })
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        return response.get_json()

    def test_new_account_is_a_full_owner_with_isolated_storage(self):
        self.assertEqual(self.login('owner').status_code, 200)
        primary_board = self.client.post('/api/boards', json={'name': 'Private primary board'}).get_json()
        shared_asset = 'shared-test-image.png'
        primary_snapshot = {'store': {'asset:shared': {
            'typeName': 'asset',
            'props': {'src': f'/uploads/{shared_asset}'},
        }}}
        self.assertEqual(self.client.put(
            f"/api/boards/{primary_board['id']}", json={'snapshot': primary_snapshot}
        ).status_code, 204)
        with open(os.path.join(self.upload_dir, shared_asset), 'wb') as asset_file:
            asset_file.write(b'test-image')
        secondary = self.create_secondary_account()

        stored_accounts = server._load_local_json(server.ACCOUNTS_FILE, [])
        stored_secondary = next(item for item in stored_accounts if item['id'] == secondary['id'])
        self.assertNotIn('correct horse battery', str(stored_secondary))
        self.assertTrue(stored_secondary['password_hash'])

        self.client.post('/api/auth/logout')
        secondary_login = self.login('correct horse battery')
        self.assertEqual(secondary_login.status_code, 200, secondary_login.get_data(as_text=True))
        self.assertEqual(secondary_login.get_json()['access'], server.ACCESS_OWNER)
        self.assertFalse(secondary_login.get_json()['is_admin'])
        self.assertEqual(self.client.get('/api/accounts').status_code, 403)
        workspace = self.client.get('/api/workspace').get_json()
        self.assertEqual(workspace['name'], 'Station 8')
        self.assertEqual(workspace['owner'], 'Station 8')
        self.assertEqual(self.client.get('/api/boards').get_json(), [])
        self.assertEqual(self.client.get(f"/api/boards/{primary_board['id']}").status_code, 404)
        self.assertEqual(self.client.put(
            f"/api/boards/{primary_board['id']}", json={'snapshot': {'store': {}}}
        ).status_code, 404)

        secondary_board = self.client.post('/api/boards', json={'name': 'Secondary board'}).get_json()
        self.assertEqual(self.client.put(
            f"/api/boards/{secondary_board['id']}", json={'snapshot': primary_snapshot}
        ).status_code, 204)
        self.assertEqual(self.client.get('/api/boards').get_json()[0]['id'], secondary_board['id'])
        tenant_board_path = os.path.join(
            self.data_dir, 'accounts', secondary['id'], f"board-{secondary_board['id']}.json"
        )
        self.assertTrue(os.path.exists(tenant_board_path))
        pdf_ticket = self.client.post('/api/pdfs/upload-ticket', json={
            'filename': 'secondary.pdf',
            'size_bytes': 10,
            'mime_type': 'application/pdf',
        })
        self.assertEqual(pdf_ticket.status_code, 201, pdf_ticket.get_data(as_text=True))
        with self.client.session_transaction() as session_data:
            ticket = pdf_ticket.get_json()['ticket']
            storage_path = session_data[server.PDF_UPLOAD_TICKETS_SESSION_KEY][ticket]['storage_path']
        self.assertTrue(storage_path.startswith(f"accounts/{secondary['id']}/"))

        self.client.post('/api/auth/logout')
        self.assertEqual(self.login('owner').status_code, 200)
        primary_boards = self.client.get('/api/boards').get_json()
        self.assertEqual([item['id'] for item in primary_boards], [primary_board['id']])
        self.assertEqual(self.client.get(f"/api/boards/{secondary_board['id']}").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/boards/{primary_board['id']}").status_code, 204)
        self.assertTrue(os.path.exists(os.path.join(self.upload_dir, shared_asset)))

    def test_visitor_profile_password_opens_its_workspace(self):
        self.assertEqual(self.login('owner').status_code, 200)
        self.create_secondary_account()
        self.client.post('/api/auth/logout')
        self.assertEqual(self.login('correct horse battery').status_code, 200)
        board = self.client.post('/api/boards', json={'name': 'Secondary shared board'}).get_json()
        snapshot = {'store': {'shape:test': {'typeName': 'shape', 'props': {'text': 'tenant marker'}}}}
        self.assertEqual(self.client.put(
            f"/api/boards/{board['id']}", json={'snapshot': snapshot}
        ).status_code, 204)
        profile = self.client.post('/api/access-profiles', json={
            'name': 'Family',
            'password': 'visitor access phrase',
            'workspace': True,
        })
        self.assertEqual(profile.status_code, 201, profile.get_data(as_text=True))

        self.client.post('/api/auth/logout')
        visitor = self.login('visitor access phrase')
        self.assertEqual(visitor.status_code, 200, visitor.get_data(as_text=True))
        self.assertEqual(visitor.get_json()['access'], server.ACCESS_VISITOR)
        visible = self.client.get('/api/visitor/boards').get_json()
        self.assertEqual([item['id'] for item in visible], [board['id']])
        detail = self.client.get(f"/api/visitor/boards/{board['id']}")
        self.assertEqual(detail.status_code, 200, detail.get_data(as_text=True))
        self.assertEqual(detail.get_json()['snapshot'], snapshot)

    def test_admin_can_disable_account_without_deleting_its_data(self):
        self.assertEqual(self.login('owner').status_code, 200)
        secondary = self.create_secondary_account()
        self.client.post('/api/auth/logout')
        self.assertEqual(self.login('correct horse battery').status_code, 200)
        board = self.client.post('/api/boards', json={'name': 'Preserved'}).get_json()

        self.client.post('/api/auth/logout')
        self.assertEqual(self.login('owner').status_code, 200)
        disabled = self.client.patch(f"/api/accounts/{secondary['id']}", json={'active': False})
        self.assertEqual(disabled.status_code, 200)
        self.assertFalse(disabled.get_json()['active'])
        self.client.post('/api/auth/logout')
        self.assertEqual(self.login('correct horse battery').status_code, 401)
        tenant_index = os.path.join(self.data_dir, 'accounts', secondary['id'], 'boards.json')
        self.assertTrue(os.path.exists(tenant_index))
        with open(tenant_index, encoding='utf-8') as tenant_file:
            self.assertIn(board['id'], tenant_file.read())

    def test_users_change_their_own_password_with_current_password(self):
        self.assertEqual(self.login('owner').status_code, 200)
        secondary = self.create_secondary_account()
        own_admin_reset = self.client.patch(
            '/api/accounts/primary', json={'password': 'replacement owner phrase'}
        )
        self.assertEqual(own_admin_reset.status_code, 400)

        self.client.post('/api/auth/logout')
        self.assertEqual(self.login('correct horse battery').status_code, 200)
        wrong_current = self.client.patch('/api/account', json={
            'current_password': 'not the current password',
            'new_password': 'replacement account phrase',
        })
        self.assertEqual(wrong_current.status_code, 401)
        changed = self.client.patch('/api/account', json={
            'current_password': 'correct horse battery',
            'new_password': 'replacement account phrase',
        })
        self.assertEqual(changed.status_code, 200, changed.get_data(as_text=True))

        self.client.post('/api/auth/logout')
        self.assertEqual(self.login('correct horse battery').status_code, 401)
        self.assertEqual(self.login('replacement account phrase').status_code, 200)
        self.assertEqual(self.client.get('/api/account').get_json()['id'], secondary['id'])

    def test_repeated_bad_logins_are_rate_limited(self):
        for _attempt in range(server.LOGIN_ATTEMPT_LIMIT):
            response = self.login('incorrect password')
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.get_json()['error'], 'Wrong password')
        limited = self.login('incorrect password')
        self.assertEqual(limited.status_code, 429)
        self.assertIn('Retry-After', limited.headers)

    def test_render_environment_provisions_and_updates_secondary_password(self):
        os.environ[server.SECONDARY_ACCOUNT_PASSWORD_ENV] = 'initial account phrase'
        account = server._sync_secondary_account_from_environment()
        self.assertEqual(account['id'], server.SECONDARY_ACCOUNT_ID)
        self.assertFalse(account['admin'])

        stored = server._load_local_json(server.ACCOUNTS_FILE, [])
        self.assertNotIn('initial account phrase', str(stored))
        self.assertEqual(self.login('initial account phrase').status_code, 200)

        self.client.post('/api/auth/logout')
        os.environ[server.SECONDARY_ACCOUNT_PASSWORD_ENV] = 'replacement account phrase'
        server._sync_secondary_account_from_environment()
        self.assertEqual(self.login('initial account phrase').status_code, 401)
        self.assertEqual(self.login('replacement account phrase').status_code, 200)


if __name__ == '__main__':
    unittest.main()
