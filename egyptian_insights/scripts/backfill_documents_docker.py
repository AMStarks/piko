#!/usr/bin/env python3
"""Run inside legion-adapter container to backfill local PDFs."""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, "/app")
from egyptian_insights import db
from egyptian_insights.sources.base import download_document, polite_sleep


def main() -> None:
    conn = db.connect()
    conn.row_factory = sqlite3.Row
    docs = db.documents_dir()
    docs.mkdir(parents=True, exist_ok=True)
    updated = 0
    for row in conn.execute(
        "SELECT id, source, source_id, source_url, title, meta_json FROM harvest_items"
    ).fetchall():
        meta = json.loads(row["meta_json"] or "{}")
        path = meta.get("document_path")
        if path and Path(str(path)).is_file():
            continue
        if ":chunk:" in str(row["source_id"] or ""):
            continue
        pdf_url = meta.get("document_url") or meta.get("pdf_url")
        if not pdf_url:
            continue
        polite_sleep(0.3)
        raw = download_document(str(pdf_url), timeout=180.0, referer=str(row["source_url"] or ""))
        if not raw or len(raw) < 800:
            print("fail", row["id"], (row["title"] or "")[:40], "bytes", 0 if not raw else len(raw))
            continue
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(row["source_id"]))[:100]
        dest = docs / f"{row['source']}_{safe}.pdf"
        dest.write_bytes(raw)
        meta["document_path"] = str(dest)
        meta["document_url"] = str(pdf_url)
        meta["document_bytes"] = len(raw)
        conn.execute(
            "UPDATE harvest_items SET meta_json=? WHERE id=?",
            (json.dumps(meta, ensure_ascii=False), row["id"]),
        )
        updated += 1
        print("ok", row["id"], dest.name, len(raw))
    conn.commit()
    print("updated", updated)
    row = conn.execute("SELECT meta_json FROM harvest_items WHERE id=201").fetchone()
    if row:
        meta = json.loads(row["meta_json"])
        p = Path(str(meta.get("document_path") or ""))
        print("201 path", p, "exists", p.is_file())
    conn.close()


if __name__ == "__main__":
    main()
