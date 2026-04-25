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
import sys
from datetime import datetime, timezone

from _common import supabase_client

if len(sys.argv) != 3:
    sys.exit(__doc__.strip())

backup_id, target_id = sys.argv[1], sys.argv[2]
client = supabase_client()

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
