"""Backfill OCR for every image in the production uploads bucket.

Downloads each image from Supabase storage, runs the same preprocessing +
Tesseract pipeline used server-side in server.py, and upserts ocr.json back
to the Supabase json_storage table. Safe to re-run.
"""
import io
import os
import re

from _common import supabase_client

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

print("Listing uploads bucket...", flush=True)
listed = client.storage.from_("uploads").list() or []
files = sorted(
    item["name"]
    for item in listed
    if isinstance(item, dict)
    and item.get("name")
    and os.path.splitext(item["name"])[1].lower() in exts
)
print(f"  -> {len(files)} images", flush=True)

print("Loading current ocr.json...", flush=True)
resp = client.table("json_storage").select("data").eq("id", "ocr.json").execute()
ocr = resp.data[0]["data"] if resp.data else {}
print(f"  -> {len(ocr)} existing entries", flush=True)

updated = 0
unchanged = 0
empty = 0

for idx, name in enumerate(files, 1):
    prev = ocr.get(name, "")
    try:
        blob = client.storage.from_("uploads").download(name)
    except Exception as exc:
        print(f"[{idx:>3}/{len(files)}] {name}: download failed: {exc}", flush=True)
        continue
    text = run_ocr_bytes(blob)
    ocr[name] = text
    status = "(empty)" if not text else f"{len(text)} chars: {text[:60]!r}"
    flag = "=" if text == prev else ("+" if prev == "" else "~")
    print(f"[{idx:>3}/{len(files)}] {flag} {name}: {status}", flush=True)
    if not text:
        empty += 1
    elif text == prev:
        unchanged += 1
    else:
        updated += 1

print(f"\nSaving ocr.json back to Supabase...", flush=True)
client.table("json_storage").upsert({"id": "ocr.json", "data": ocr}).execute()

print(
    f"\nDone. updated={updated}  unchanged={unchanged}  empty={empty}  total={len(files)}",
    flush=True,
)
