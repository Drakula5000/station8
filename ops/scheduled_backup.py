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
from datetime import datetime, timezone, timedelta

from _common import supabase_client, list_all_json_rows

RETENTION_DAYS = int(os.getenv("BACKUP_RETENTION_DAYS", "7"))
RESERVED_SUFFIXES = (".auto-", ".manual-", ".pre-", ".backup-")
# Prune these suffix families by age
PRUNABLE_ID_RE = re.compile(r"\.(auto|pre-deploy)-(\d{8}-\d{6})\.json$")
AUTO_ID_RE = re.compile(r"\.auto-(\d{8}-\d{6})\.json$")
BACKUP_SUFFIX = os.getenv("BACKUP_SUFFIX", "auto")  # 'auto' for cron, 'pre-deploy' for deploys

client = supabase_client()

def is_primary(row_id: str) -> bool:
    return not any(suffix in row_id for suffix in RESERVED_SUFFIXES)

def list_all_rows():
    return list_all_json_rows(client, columns="id")

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
    print(f"Wrote {written} new .{BACKUP_SUFFIX}-{ts} rows, skipped {unchanged} unchanged rows")
    cutoff = now - timedelta(days=RETENTION_DAYS)
    deleted = prune_old_auto_backups(cutoff)
    print(f"Pruned {deleted} .auto-* rows older than {RETENTION_DAYS} days (before {cutoff.isoformat()})")

if __name__ == "__main__":
    main()
