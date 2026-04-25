"""Read-only health check of the production OCR index.

Pulls ocr.json from Supabase, reports how many entries have text, previews a few,
and lists any image filenames referenced by boards that are missing from the index.

Usage:
  python ops/check_ocr.py
  (reads SUPABASE_URL / SUPABASE_KEY from env or ./ops/.backup-env)
"""
import re

from _common import supabase_client

client = supabase_client()

def load_row(row_id):
    resp = client.table("json_storage").select("data").eq("id", row_id).execute()
    if resp.data:
        return resp.data[0]["data"]
    return None

ocr = load_row("ocr.json") or {}
boards_index = load_row("boards.json") or []

# Which filenames are referenced by boards?
referenced = set()
for b in boards_index:
    data = load_row(f"board-{b['id']}.json") or {}
    snap = data.get("snapshot") or {}
    store = snap.get("store") or {}
    for rec in store.values():
        if not isinstance(rec, dict) or rec.get("typeName") != "asset":
            continue
        src = ((rec.get("props") or {}).get("src") or "")
        m = re.search(r"/uploads/([a-zA-Z0-9-]+\.[a-zA-Z]+)", src)
        if m:
            referenced.add(m.group(1))

total = len(ocr)
with_text = sum(1 for v in ocr.values() if v)
empty = total - with_text

referenced_with_text = sum(1 for n in referenced if ocr.get(n))
referenced_blank = sum(1 for n in referenced if n in ocr and not ocr[n])
referenced_missing = sum(1 for n in referenced if n not in ocr)

print(f"ocr.json rows in Supabase:       {total}")
print(f"  with text:                     {with_text}")
print(f"  empty:                         {empty}")
print()
print(f"Image filenames used by boards:  {len(referenced)}")
print(f"  with OCR text:                 {referenced_with_text}")
print(f"  stored as empty:               {referenced_blank}")
print(f"  not in ocr.json at all:        {referenced_missing}")

if with_text > 0:
    print()
    print("Sample OCR previews:")
    for name, text in list(ocr.items())[:5]:
        if text:
            print(f"  {name}: {text[:120]}")

# Word hit check
print()
for probe in ("dry", "outcrop", "geological", "sample"):
    hits = [name for name, text in ocr.items() if text and probe.lower() in text.lower()]
    print(f"  grep '{probe}' in ocr.json -> {len(hits)} matches")

# Verdict
print()
if referenced_with_text >= max(1, len(referenced) // 2):
    print("VERDICT: OCR looks populated. Visitor search should work.")
elif referenced_with_text == 0:
    print("VERDICT: Zero images have OCR text. Rescan has not been run (or failed).")
else:
    print("VERDICT: Partial coverage. Rescan not finished or some images unreadable.")
