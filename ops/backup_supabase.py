"""One-shot backup of everything in Supabase for this app.

Reads SUPABASE_URL / SUPABASE_KEY from the environment (or from ./ops/.backup-env).
Dumps:
  - every row in the `json_storage` table  -> backups/<timestamp>/json/<id>.json
  - every file in the `uploads` bucket     -> backups/<timestamp>/uploads/<filename>

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
uploads_dir = out_dir / "uploads"
json_dir.mkdir(parents=True, exist_ok=True)
uploads_dir.mkdir(parents=True, exist_ok=True)

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

# ---- Dump uploads bucket ----
print("Dumping uploads bucket...", flush=True)
uploaded_count = 0
failed = []
try:
    listed = client.storage.from_("uploads").list()
    for item in listed or []:
        name = item.get("name") if isinstance(item, dict) else None
        if not name:
            continue
        try:
            blob = client.storage.from_("uploads").download(name)
            (uploads_dir / name).write_bytes(blob)
            uploaded_count += 1
        except Exception as exc:
            failed.append(f"{name}: {exc}")
except Exception as exc:
    manifest_lines.append(f"uploads bucket list FAILED: {exc}")
    print(f"  !! uploads list failed: {exc}", flush=True)

manifest_lines.append(f"uploads files: {uploaded_count}")
if failed:
    manifest_lines.append(f"uploads failed: {len(failed)}")
    manifest_lines.extend("  " + line for line in failed)
print(f"  -> {uploaded_count} files" + (f" ({len(failed)} failed)" if failed else ""), flush=True)

(out_dir / "manifest.txt").write_text("\n".join(manifest_lines) + "\n")

print()
print(f"Backup complete: {out_dir}", flush=True)
print(f"  json rows: {len(rows)}", flush=True)
print(f"  uploads:   {uploaded_count}", flush=True)
