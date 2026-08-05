import os
import tempfile
import unittest

os.environ.pop('SUPABASE_URL', None)
os.environ.pop('SUPABASE_KEY', None)
os.environ.pop('S8_SECONDARY_PASSWORD', None)

import server


class GoogleReconnectTest(unittest.TestCase):
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
        'ACCOUNTS_FILE': 'accounts.json',
        'REPORTS_FILE': 'reports.json',
        'R_TOKENS_FILE': 'r_tokens.json',
        'PDFS_FILE': 'pdfs.json',
    }

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='station8-google-reconnect-')
        data_dir = os.path.join(self.tmp.name, 'data')
        os.makedirs(data_dir)
        server.DATA_DIR = data_dir
        server.STORAGE_ROOT = self.tmp.name
        server.UPLOADS_DIR = os.path.join(self.tmp.name, 'uploads')
        server.PDFS_DIR = os.path.join(self.tmp.name, 'pdfs')
        os.makedirs(server.UPLOADS_DIR)
        os.makedirs(server.PDFS_DIR)
        for attr, filename in self.FILES.items():
            setattr(server, attr, os.path.join(data_dir, filename))
        server.supabase = None
        server.app.config.update(TESTING=True, SECRET_KEY='google-reconnect-test')
        self.client = server.app.test_client()
        response = self.client.post('/api/auth/login', json={'password': 'owner'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def tearDown(self):
        server.supabase = None
        self.tmp.cleanup()

    def save_expired_testing_connection(self):
        server._save_google_token_record({
            'connected': True,
            'email': 'tester@example.com',
            'access_token': 'expired-access-token',
            'token_expires_at': '2000-01-01T00:00:00',
        })

    def test_status_marks_expired_testing_connection_for_reconnect(self):
        self.save_expired_testing_connection()
        response = self.client.get('/api/google/status')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertFalse(data['connected'])
        self.assertTrue(data['reconnect_required'])
        self.assertEqual(data['email'], 'tester@example.com')

    def test_expired_connection_does_not_create_orphan_records(self):
        self.save_expired_testing_connection()
        doc = self.client.post('/api/gdocs', json={'name': 'Should not exist'})
        sheet = self.client.post('/api/gsheets', json={'name': 'Should not exist either'})
        self.assertEqual(doc.status_code, 409)
        self.assertEqual(sheet.status_code, 409)
        self.assertEqual(doc.get_json()['error'], 'google_reconnect_required')
        self.assertEqual(sheet.get_json()['error'], 'google_reconnect_required')
        self.assertEqual(self.client.get('/api/gdocs').get_json(), [])
        self.assertEqual(self.client.get('/api/gsheets').get_json(), [])

    def test_existing_drive_url_can_still_be_imported_without_connection(self):
        server._save_google_token_record({'connected': False, 'email': None})
        url = 'https://docs.google.com/document/d/example/edit'
        response = self.client.post('/api/gdocs', json={
            'name': 'Imported doc',
            'embed_url': url,
        })
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['embed_url'], url)
        self.assertEqual(len(self.client.get('/api/gdocs').get_json()), 1)


if __name__ == '__main__':
    unittest.main()
