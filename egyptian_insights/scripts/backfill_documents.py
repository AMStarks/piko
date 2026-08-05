#!/usr/bin/env python3
"""Backfill local PDF/documents for literature rows that have remote document URLs or IA identifiers."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(os.environ.get("EGYPTIAN_INSIGHTS_ROOT") or "/home/chief/projects/Piko")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from egyptian_insights import db  # noqa: E402
from egyptian_insights.sources.archive_org import _ocr_and_pdf  # noqa: E402
from egyptian_insights.sources.base import download_document, http_get_json, polite_sleep  # noqa: E402


def main() -> int:
    data_dir = Path(os.environ.get("EGYPTIAN_INSIGHTS_DATA_DIR") or "/home/chief/data/egyptian-insights")
    os.environ["EGYPTIAN_INSIGHTS_DATA_DIR"] = str(data_dir)
    conn = db.connect()
    rows = conn.execute(
        "SELECT id, source, source_id, source_url, title, meta_json FROM harvest_items ORDER BY id"
    ).fetchall()
    docs = db.documents_dir()
    docs.mkdir(parents=True, exist_ok=True)
    updated = 0
    skipped = 0
    failed = 0
    for row in rows:
        meta = {}
        try:
            meta = json.loads(row["meta_json"] or "{}")
        except json.JSONDecodeError:
            meta = {}
        existing = meta.get("document_path")
        if existing and Path(str(existing)).is_file():
            skipped += 1
            continue
        # Remap docker path
        if existing:
            remapped = str(existing).replace("/data/egyptian-insights/", str(data_dir) + "/")
            if Path(remapped).is_file():
                meta["document_path"] = remapped
                conn.execute(
                    "UPDATE harvest_items SET meta_json=? WHERE id=?",
                    (json.dumps(meta, ensure_ascii=False), row["id"]),
                )
                updated += 1
                continue

        pdf_url = meta.get("document_url") or meta.get("pdf_url")
        if not pdf_url and row["source"] == "archive_org" and row["source_id"] and ":chunk:" not in str(row["source_id"]):
            try:
                polite_sleep(0.25)
                data = http_get_json(f"https://archive.org/metadata/{row['source_id']}", timeout=40.0)
                assets = _ocr_and_pdf(str(row["source_id"]), list(data.get("files") or []))
                pdf_url = assets.get("pdf_url")
            except Exception as exc:
                print(f"meta_fail #{row['id']} {row['source_id']}: {exc}")
                failed += 1
                continue

        if not pdf_url:
            skipped += 1
            continue

        try:
            polite_sleep(0.35)
            raw = download_document(str(pdf_url), timeout=180.0, referer=str(row["source_url"] or ""))
            if not raw or len(raw) < 500:
                print(f"download_thin #{row['id']} {row['title'][:40]}")
                failed += 1
                continue
            safe_src = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(row["source"]))
            safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(row["source_id"]))[:80]
            dest = docs / f"{safe_src}_{safe_id}.pdf"
            dest.write_bytes(raw)
            meta["document_path"] = str(dest)
            meta["document_url"] = str(pdf_url)
            meta["document_bytes"] = len(raw)
            conn.execute(
                "UPDATE harvest_items SET meta_json=? WHERE id=?",
                (json.dumps(meta, ensure_ascii=False), row["id"]),
            )
            updated += 1
            print(f"saved #{row['id']} -> {dest.name} ({len(raw)} bytes)")
        except Exception as exc:
            print(f"fail #{row['id']}: {exc}")
            failed += 1
    conn.commit()
    conn.close()
    print(json.dumps({"updated": updated, "skipped": skipped, "failed": failed}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
