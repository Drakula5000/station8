"""One-shot restore: copy a backup row's data over a primary row.

Usage:
    python ops/restore_backup.py <backup_id> <target_id>

Example:
    python ops/restore_backup.py \\
        board-057f4a24.auto-20260424-201937.json \\
        board-057f4a24.json

Always snapshots the target first as
`<target_stem>.pre-restore-<timestamp>.json` so the operation is reversible.
"""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent / ".backup-env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

if len(sys.argv) != 3:
    sys.exit(__doc__.strip())

backup_id, target_id = sys.argv[1], sys.argv[2]

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("Missing SUPABASE_URL / SUPABASE_KEY")

from supabase import create_client
client = create_client(SUPABASE_URL, SUPABASE_KEY)

backup = client.table("json_storage").select("*").eq("id", backup_id).execute()
if not backup.data:
    sys.exit(f"Backup not found: {backup_id}")

target = client.table("json_storage").select("*").eq("id", target_id).execute()
if target.data:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safety_id = f"{target_id.removesuffix('.json')}.pre-restore-{ts}.json"
    client.table("json_storage").upsert({"id": safety_id, "data": target.data[0]["data"]}).execute()
    print(f"Saved pre-restore snapshot: {safety_id}")
else:
    print(f"(Target {target_id} did not exist — creating)")

client.table("json_storage").upsert({"id": target_id, "data": backup.data[0]["data"]}).execute()
print(f"Restored {backup_id} -> {target_id}")
