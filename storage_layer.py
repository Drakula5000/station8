import json
import os
import uuid


class JsonStore:
    def __init__(self, *, supabase_getter, table_name, storage_location):
        self._supabase_getter = supabase_getter
        self._table_name = table_name
        self._storage_location = storage_location

    def _client(self):
        return self._supabase_getter()

    def load(self, path, default):
        local_path, file_id = self._storage_location(path)
        client = self._client()
        if client:
            try:
                response = client.table(self._table_name).select('data').eq('id', file_id).execute()
                if response.data:
                    return response.data[0]['data']
            except Exception as exc:
                print(f'Supabase load failed for {path}: {exc}', flush=True)
        if not os.path.exists(local_path):
            return default
        with open(local_path, 'r') as handle:
            return json.load(handle)

    def load_local(self, path, default):
        local_path, _file_id = self._storage_location(path)
        if not os.path.exists(local_path):
            return default
        try:
            with open(local_path, 'r') as handle:
                return json.load(handle)
        except Exception:
            return default

    def write_local_atomic(self, path, data):
        local_path, _file_id = self._storage_location(path)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        tmp_path = f'{local_path}.tmp-{uuid.uuid4().hex}'
        try:
            with open(tmp_path, 'w') as handle:
                json.dump(data, handle, indent=2)
            os.replace(tmp_path, local_path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def save(self, path, data, *, require_remote=True):
        _local_path, file_id = self._storage_location(path)
        client = self._client()
        if client:
            try:
                client.table(self._table_name).upsert({'id': file_id, 'data': data}).execute()
            except Exception as exc:
                if require_remote:
                    raise
                print(f'Supabase save failed for {path}: {exc}', flush=True)
        self.write_local_atomic(path, data)

    def delete(self, path, *, strict=False):
        local_path, file_id = self._storage_location(path)
        client = self._client()
        remote_error = None
        local_error = None
        if client:
            try:
                client.table(self._table_name).delete().eq('id', file_id).execute()
            except Exception as exc:
                remote_error = exc
                print(f'Supabase delete failed for {file_id}: {exc}', flush=True)
        if remote_error is None or not strict:
            try:
                if os.path.exists(local_path):
                    os.remove(local_path)
            except OSError as exc:
                local_error = exc
                print(f'Local JSON delete failed for {file_id}: {exc}', flush=True)
                if strict:
                    raise
        if remote_error is not None and strict:
            raise remote_error
        return remote_error is None and local_error is None
