"""One-shot backup of everything in Supabase for this app.

Reads SUPABASE_URL / SUPABASE_KEY from the environment (or from ./ops/.backup-env).
Dumps:
  - every row in the `json_storage` table  -> backups/<timestamp>/json/<id>.json
  - every file in the `uploads` bucket     -> backups/<timestamp>/uploads/<filename>
  - every file in the private `pdfs` bucket -> backups/<timestamp>/pdfs/<filename>

Writes a manifest.txt summarizing the dump. Safe to run repeatedly.
"""
import json
import os
from datetime import datetime
from pathlib import Path

from _common import supabase_client, list_all_json_rows

REPO = Path(__file__).resolve().parent.parent
client = supabase_client()

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
out_dir = REPO / "backups" / stamp
json_dir = out_dir / "json"
json_dir.mkdir(parents=True, exist_ok=True)

manifest_lines = [f"Backup taken: {datetime.now().isoformat()}", f"Supabase URL: {os.getenv('SUPABASE_URL')}", ""]

# ---- Dump json_storage ----
print("Dumping json_storage table...", flush=True)
rows = list_all_json_rows(client)

for row in rows:
    row_id = row.get("id") or f"row-{rows.index(row)}"
    safe_id = row_id.replace("/", "_")
    (json_dir / safe_id).write_text(json.dumps(row.get("data"), indent=2))
manifest_lines.append(f"json_storage rows: {len(rows)}")
print(f"  -> {len(rows)} rows", flush=True)

def list_bucket_files(bucket, prefix=""):
    """Yield every object path, including objects inside storage folders."""
    offset = 0
    while True:
        listed = bucket.list(
            prefix or None,
            {"limit": 100, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
        ) or []
        for item in listed:
            name = item.get("name") if isinstance(item, dict) else None
            if not name:
                continue
            object_path = f"{prefix}/{name}" if prefix else name
            # Supabase represents folders as rows without an object id/metadata.
            if not item.get("id") and not item.get("metadata"):
                yield from list_bucket_files(bucket, object_path)
            else:
                yield object_path
        if len(listed) < 100:
            break
        offset += len(listed)


def dump_bucket(bucket_name):
    print(f"Dumping {bucket_name} bucket...", flush=True)
    bucket = client.storage.from_(bucket_name)
    bucket_dir = out_dir / bucket_name
    bucket_dir.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    failed = []
    try:
        object_paths = list(list_bucket_files(bucket))
    except Exception as exc:
        manifest_lines.append(f"{bucket_name} bucket list FAILED: {exc}")
        print(f"  !! {bucket_name} list failed: {exc}", flush=True)
        return 0

    for object_path in object_paths:
        try:
            blob = bucket.download(object_path)
            destination = bucket_dir / object_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(blob)
            downloaded += 1
        except Exception as exc:
            failed.append(f"{object_path}: {exc}")

    manifest_lines.append(f"{bucket_name} files: {downloaded}")
    if failed:
        manifest_lines.append(f"{bucket_name} failed: {len(failed)}")
        manifest_lines.extend("  " + line for line in failed)
    print(f"  -> {downloaded} files" + (f" ({len(failed)} failed)" if failed else ""), flush=True)
    return downloaded


# JSON records and uploaded binaries have separate backup lifecycles. Dump both
# storage buckets here; scheduled_backup.py only snapshots json_storage rows.
bucket_counts = {name: dump_bucket(name) for name in ("uploads", "pdfs")}

(out_dir / "manifest.txt").write_text("\n".join(manifest_lines) + "\n")

print()
print(f"Backup complete: {out_dir}", flush=True)
print(f"  json rows: {len(rows)}", flush=True)
for bucket_name, count in bucket_counts.items():
    print(f"  {bucket_name + ':':<10}{count}", flush=True)
