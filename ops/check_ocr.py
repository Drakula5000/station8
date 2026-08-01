"""Read-only health check of the production OCR index.

Pulls ocr.json from Supabase, reports how many entries have text, previews a few,
and lists any image filenames referenced by boards that are missing from the index.

Usage:
  python ops/check_ocr.py
  (reads SUPABASE_URL / SUPABASE_KEY from env or ./ops/.backup-env)
"""
import re

from _common import list_all_json_rows, supabase_client

client = supabase_client()

rows = list_all_json_rows(client)
row_by_id = {row["id"]: row.get("data") for row in rows if row.get("id")}
board_index_ids = sorted(
    row_id for row_id in row_by_id
    if row_id == "boards.json" or (
        row_id.startswith("account-") and row_id.endswith("-boards.json")
    )
)

healthy = 0
for board_index_id in board_index_ids:
    prefix = board_index_id[:-len("boards.json")]
    label = "primary" if not prefix else prefix.removeprefix("account-").removesuffix("-")
    ocr = row_by_id.get(f"{prefix}ocr.json") or {}
    referenced = set()
    for board in row_by_id.get(board_index_id) or []:
        if not isinstance(board, dict) or not board.get("id"):
            continue
        data = row_by_id.get(f"{prefix}board-{board['id']}.json") or {}
        snap = data.get("snapshot") or {}
        store = snap.get("store") or {}
        for rec in store.values():
            if not isinstance(rec, dict) or rec.get("typeName") != "asset":
                continue
            src = ((rec.get("props") or {}).get("src") or "")
            match = re.search(r"/uploads/([a-zA-Z0-9-]+\.[a-zA-Z]+)", src)
            if match:
                referenced.add(match.group(1))

    with_text = sum(1 for name in referenced if ocr.get(name))
    blank = sum(1 for name in referenced if name in ocr and not ocr[name])
    missing = sum(1 for name in referenced if name not in ocr)
    print(f"Workspace {label}: {len(referenced)} referenced images")
    print(f"  with OCR text: {with_text}  blank: {blank}  missing: {missing}")
    if not referenced or with_text >= max(1, len(referenced) // 2):
        healthy += 1

print()
print(f"VERDICT: {healthy}/{len(board_index_ids)} workspaces have healthy OCR coverage.")
