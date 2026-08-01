"""Backfill OCR for every image in the production uploads bucket.

Downloads each image from Supabase storage, runs the same preprocessing +
Tesseract pipeline used server-side in server.py, and upserts ocr.json back
to the Supabase json_storage table. Safe to re-run.
"""
import io
import os
import re

from _common import list_all_json_rows, supabase_client

import pytesseract  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

client = supabase_client()


def run_ocr_bytes(blob: bytes) -> str:
    try:
        img = Image.open(io.BytesIO(blob))
        if img.mode != "RGB":
            img = img.convert("RGB")
        target_w = 2000
        if img.width < target_w:
            scale = target_w / img.width
            img = img.resize(
                (int(img.width * scale), int(img.height * scale)), Image.LANCZOS
            )
        gray = ImageOps.grayscale(img)
        enhanced = ImageOps.autocontrast(gray, cutoff=2)
        results = []
        for psm in (3, 11):
            try:
                text = pytesseract.image_to_string(
                    enhanced, config=f"--oem 1 --psm {psm}"
                )
                results.append(re.sub(r"\s+", " ", text).strip())
            except Exception:
                continue
        return max(results, key=len) if results else ""
    except Exception as exc:
        print(f"  OCR failed: {exc}", flush=True)
        return ""


exts = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
upload_ref_re = re.compile(r"/uploads/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)")

print("Loading account-scoped board indexes...", flush=True)
rows = list_all_json_rows(client)
row_by_id = {row["id"]: row.get("data") for row in rows if row.get("id")}
board_index_ids = sorted(
    row_id for row_id in row_by_id
    if row_id == "boards.json" or (
        row_id.startswith("account-") and row_id.endswith("-boards.json")
    )
)

scopes = []
all_referenced = set()
for board_index_id in board_index_ids:
    prefix = board_index_id[:-len("boards.json")]
    referenced = set()
    for board in row_by_id.get(board_index_id) or []:
        if not isinstance(board, dict) or not board.get("id"):
            continue
        detail = row_by_id.get(f"{prefix}board-{board['id']}.json") or {}
        snapshot = detail.get("snapshot") if isinstance(detail, dict) else None
        if snapshot:
            referenced.update(upload_ref_re.findall(str(snapshot)))
    referenced = {
        name for name in referenced
        if os.path.splitext(name)[1].lower() in exts
    }
    ocr_id = f"{prefix}ocr.json"
    scopes.append((ocr_id, referenced))
    all_referenced.update(referenced)

print(f"  -> {len(scopes)} workspaces, {len(all_referenced)} referenced images", flush=True)

recognized = {}
for idx, name in enumerate(sorted(all_referenced), 1):
    try:
        blob = client.storage.from_("uploads").download(name)
    except Exception as exc:
        print(f"[{idx:>3}/{len(all_referenced)}] {name}: download failed: {exc}", flush=True)
        continue
    text = run_ocr_bytes(blob)
    recognized[name] = text
    status = "(empty)" if not text else f"{len(text)} chars: {text[:60]!r}"
    print(f"[{idx:>3}/{len(all_referenced)}] {name}: {status}", flush=True)

updated = 0
for ocr_id, referenced in scopes:
    ocr = row_by_id.get(ocr_id)
    ocr = dict(ocr) if isinstance(ocr, dict) else {}
    changed = False
    for name in referenced:
        if name not in recognized:
            continue
        if ocr.get(name) != recognized[name]:
            ocr[name] = recognized[name]
            changed = True
    if changed:
        client.table("json_storage").upsert({"id": ocr_id, "data": ocr}).execute()
        updated += 1

print(f"\nDone. updated_workspaces={updated} total_workspaces={len(scopes)}", flush=True)
