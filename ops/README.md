# ops/

Internal scripts for backup, restore, and maintenance. Not required for self-hosting.

| script | what it does |
|:---|:---|
| `scheduled_backup.py` | Snapshots all Supabase `json_storage` rows to timestamped backups. Runs automatically every 2 hours via GitHub Actions; it does not copy storage-bucket binaries. |
| `backup_supabase.py` | One-shot manual backup of every JSON row plus all objects in the public `uploads` and private `pdfs` storage buckets. |
| `restore_backup.py` | Restores a backup row to a primary row. Usage: `python ops/restore_backup.py <backup_id> <target_id>` |
| `backfill_ocr.py` | Re-OCRs all images in the Supabase uploads bucket and pushes the updated index back. Run if the search index drifts. |
| `check_ocr.py` | Inspects the current OCR index. |
| `_common.py` | Shared utilities used by the other scripts. |

Credentials are read from environment variables or `ops/.backup-env` (gitignored).
