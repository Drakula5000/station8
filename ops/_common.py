"""Shared helpers for ops scripts.

Each script previously repeated ~25 lines of env-loading + Supabase client
setup. Centralised here so the scripts can stay focused on their actual job.
"""
import os
import sys
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent / ".backup-env"


def _load_env_file():
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def supabase_client():
    """Load env (file + process), return a configured Supabase client.
    Exits with a clear message if creds are missing.
    """
    _load_env_file()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        sys.exit(f"Missing SUPABASE_URL / SUPABASE_KEY. Fill {ENV_FILE} or export them in the shell.")
    from supabase import create_client
    return create_client(url, key)


def list_all_json_rows(client, columns="id, data"):
    """Page through every row in the json_storage table and return them all."""
    rows = []
    page_size = 1000
    offset = 0
    while True:
        batch = client.table("json_storage").select(columns).range(offset, offset + page_size - 1).execute()
        if not batch.data:
            break
        rows.extend(batch.data)
        if len(batch.data) < page_size:
            break
        offset += page_size
    return rows
