"""Autobackup every primary json_storage row into a timestamped `.auto-*` copy
and prune `.auto-*` rows older than RETENTION_DAYS.

Intended to be run on a schedule (GitHub Actions cron, every 2 hours).

Reads SUPABASE_URL / SUPABASE_KEY from the environment.

A "primary" row is any id that does NOT contain one of the reserved suffixes
(`.auto-`, `.manual-`, `.pre-`, `.backup-`). Those are already snapshots and
would otherwise back up recursively.
"""
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

RETENTION_DAYS = int(os.getenv("BACKUP_RETENTION_DAYS", "7"))
RESERVED_SUFFIXES = (".auto-", ".manual-", ".pre-", ".backup-")
# Prune these suffix families by age
PRUNABLE_ID_RE = re.compile(r"\.(auto|pre-deploy)-(\d{8}-\d{6})\.json$")
AUTO_ID_RE = re.compile(r"\.auto-(\d{8}-\d{6})\.json$")
BACKUP_SUFFIX = os.getenv("BACKUP_SUFFIX", "auto")  # 'auto' for cron, 'pre-deploy' for deploys

# Local fallback: if running on the user's machine, read ops/.backup-env
ENV_FILE = Path(__file__).resolve().parent / ".backup-env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("Missing SUPABASE_URL / SUPABASE_KEY in environment")

from supabase import create_client

client = create_client(SUPABASE_URL, SUPABASE_KEY)

def is_primary(row_id: str) -> bool:
    return not any(suffix in row_id for suffix in RESERVED_SUFFIXES)

def list_all_rows():
    rows = []
    page_size = 1000
    offset = 0
    while True:
        batch = client.table("json_storage").select("id").range(offset, offset + page_size - 1).execute()
        if not batch.data:
            break
        rows.extend(batch.data)
        if len(batch.data) < page_size:
            break
        offset += page_size
    return rows

def latest_auto_for(row_id: str):
    """Return the `data` of the newest .auto-* backup for this primary id, or None."""
    stem = row_id.removesuffix(".json")
    result = (
        client.table("json_storage")
        .select("id,data")
        .ilike("id", f"{stem}.auto-%.json")
        .execute()
    )
    if not result.data:
        return None
    def sortkey(row):
        m = AUTO_ID_RE.search(row["id"])
        return m.group(1) if m else ""
    newest = max(result.data, key=sortkey)
    return newest["data"]

def snapshot_primary_rows(timestamp_str: str) -> tuple[int, int]:
    """Write a new .auto-* row for every primary row whose data changed.
    Returns (written, skipped_unchanged).
    """
    import json
    rows = list_all_rows()
    primary = [r["id"] for r in rows if is_primary(r["id"])]
    print(f"Primary rows to consider: {len(primary)}")
    written = 0
    unchanged = 0
    for row_id in primary:
        full = client.table("json_storage").select("*").eq("id", row_id).execute()
        if not full.data:
            continue
        data = full.data[0]["data"]
        last = latest_auto_for(row_id)
        if last is not None and json.dumps(last, sort_keys=True) == json.dumps(data, sort_keys=True):
            unchanged += 1
            continue
        backup_id = f"{row_id.removesuffix('.json')}.{BACKUP_SUFFIX}-{timestamp_str}.json"
        client.table("json_storage").upsert({"id": backup_id, "data": data}).execute()
        written += 1
    return written, unchanged

def prune_old_auto_backups(cutoff: datetime) -> int:
    rows = list_all_rows()
    deleted = 0
    for r in rows:
        m = PRUNABLE_ID_RE.search(r["id"])
        if not m:
            continue
        try:
            ts = datetime.strptime(m.group(2), "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if ts < cutoff:
            client.table("json_storage").delete().eq("id", r["id"]).execute()
            deleted += 1
    return deleted

def main():
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%d-%H%M%S")
    print(f"Autobackup run at {now.isoformat()}")
    written, unchanged = snapshot_primary_rows(ts)
    print(f"Wrote {written} new .auto-{ts} rows, skipped {unchanged} unchanged rows")
    cutoff = now - timedelta(days=RETENTION_DAYS)
    deleted = prune_old_auto_backups(cutoff)
    print(f"Pruned {deleted} .auto-* rows older than {RETENTION_DAYS} days (before {cutoff.isoformat()})")

if __name__ == "__main__":
    main()
