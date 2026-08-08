import json
import os
import tempfile
import unittest

from storage_layer import JsonStore


class _Response:
    def __init__(self, data=None):
        self.data = data or []


class _Query:
    def __init__(self, *, remote_data=None, fail_upsert=False):
        self.remote_data = remote_data
        self.fail_upsert = fail_upsert
        self.payload = None

    def select(self, _fields): return self
    def eq(self, _key, _value): return self
    def delete(self): return self
    def upsert(self, payload):
        self.payload = payload
        return self
    def execute(self):
        if self.payload is not None and self.fail_upsert:
            raise RuntimeError('remote write failed')
        if self.payload is not None:
            self.remote_data = self.payload['data']
            return _Response()
        return _Response([{'data': self.remote_data}] if self.remote_data is not None else [])


class _Client:
    def __init__(self, query): self.query = query
    def table(self, _name): return self.query


class JsonStoreTests(unittest.TestCase):
    def make_store(self, root, query=None):
        def location(path):
            return os.path.join(root, os.path.basename(path)), os.path.basename(path)
        client = _Client(query) if query else None
        return JsonStore(supabase_getter=lambda: client, table_name='json_storage', storage_location=location)

    def test_required_remote_failure_does_not_advance_local_cache(self):
        with tempfile.TemporaryDirectory() as root:
            store = self.make_store(root, _Query(remote_data={'version': 1}, fail_upsert=True))
            path = os.path.join(root, 'workspace.json')
            store.write_local_atomic(path, {'version': 1})
            with self.assertRaises(RuntimeError):
                store.save(path, {'version': 2}, require_remote=True)
            with open(path) as handle:
                self.assertEqual(json.load(handle), {'version': 1})

    def test_successful_remote_write_then_updates_local_cache(self):
        with tempfile.TemporaryDirectory() as root:
            query = _Query(remote_data={'version': 1})
            store = self.make_store(root, query)
            path = os.path.join(root, 'workspace.json')
            store.save(path, {'version': 2}, require_remote=True)
            self.assertEqual(query.remote_data, {'version': 2})
            with open(path) as handle:
                self.assertEqual(json.load(handle), {'version': 2})

    def test_load_prefers_authoritative_remote_row(self):
        with tempfile.TemporaryDirectory() as root:
            store = self.make_store(root, _Query(remote_data={'version': 3}))
            path = os.path.join(root, 'workspace.json')
            store.write_local_atomic(path, {'version': 2})
            self.assertEqual(store.load(path, {}), {'version': 3})


if __name__ == '__main__':
    unittest.main()
