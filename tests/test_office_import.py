import io
import os
import tempfile
import unittest
from unittest.mock import patch

os.environ.pop('SUPABASE_URL', None)
os.environ.pop('SUPABASE_KEY', None)
os.environ.pop('S8_SECONDARY_PASSWORD', None)

import server


class OfficeImportTest(unittest.TestCase):
    FILES = {
        'BOARDS_FILE': 'boards.json', 'SHEETS_FILE': 'sheets.json',
        'GDOCS_FILE': 'gdocs.json', 'GSHEETS_FILE': 'gsheets.json', 'GSLIDES_FILE': 'gslides.json',
        'GOOGLE_AUTH_FILE': 'google_auth.json', 'GDRIVE_CONTENTS_FILE': 'gdrive_contents.json',
        'OCR_FILE': 'ocr.json', 'WORKSPACE_FILE': 'workspace.json', 'ACCESS_PROFILES_FILE': 'access_profiles.json',
        'AUTH_FILE': 'auth.json', 'ACCOUNTS_FILE': 'accounts.json', 'REPORTS_FILE': 'reports.json',
        'R_TOKENS_FILE': 'r_tokens.json', 'PDFS_FILE': 'pdfs.json',
    }

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='station8-office-import-')
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
        server.app.config.update(TESTING=True, SECRET_KEY='office-import-test')
        self.client = server.app.test_client()
        self.assertEqual(self.client.post('/api/auth/login', json={'password': 'owner'}).status_code, 200)
        server._save(server.WORKSPACE_FILE, {'name': 'Station 8', 'owner': 'x', 'folders': [{'id': 'course', 'name': 'Course', 'parent_id': None}]})

    def tearDown(self):
        server.supabase = None
        self.tmp.cleanup()

    def import_file(self, filename, drive_id, drive_url):
        with patch.object(server, '_get_google_access_token', return_value='token'), \
             patch.object(server, '_drive_resolve_parent_for_doc', return_value='drive-folder'), \
             patch.object(server, '_drive_import_office_file', return_value=(drive_id, drive_url)), \
             patch.object(server, '_share_drive_file_publicly', return_value=True), \
             patch.object(server, '_maybe_sync_one'):
            return self.client.post('/api/google/import-office', data={
                'folder_id': 'course',
                'file': (io.BytesIO(b'PK\x03\x04fake-office-data'), filename),
            }, content_type='multipart/form-data')

    def test_docx_drop_becomes_google_doc_in_same_station_folder(self):
        response = self.import_file('Exercises.docx', 'doc-id', 'https://docs.google.com/document/d/doc-id/edit')
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload['kind'], 'gdoc')
        self.assertEqual(payload['item']['folder_id'], 'course')
        self.assertEqual(payload['item']['name'], 'Exercises')
        self.assertEqual(server._load_gdocs()[0]['drive_file_id'], 'doc-id')

    def test_pptx_drop_becomes_google_slides_in_same_station_folder(self):
        response = self.import_file('Slides.pptx', 'slide-id', 'https://docs.google.com/presentation/d/slide-id/edit')
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload['kind'], 'gslide')
        self.assertEqual(payload['item']['folder_id'], 'course')
        self.assertEqual(server._load_gslides()[0]['drive_file_id'], 'slide-id')

    def test_other_office_types_are_rejected_explicitly(self):
        response = self.client.post('/api/google/import-office', data={
            'file': (io.BytesIO(b'PK\x03\x04fake'), 'sheet.xlsx'),
        }, content_type='multipart/form-data')
        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.get_json()['error'], 'unsupported_office_type')


if __name__ == '__main__':
    unittest.main()
