#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

from egyptian_insights import db


def main() -> None:
    conn = db.connect()
    conn.row_factory = sqlite3.Row
    docs = db.documents_dir()
    n = 0
    for row in conn.execute(
        "SELECT id, source, source_id, meta_json FROM harvest_items"
    ).fetchall():
        meta = json.loads(row["meta_json"] or "{}")
        if meta.get("document_path") and Path(str(meta["document_path"])).is_file():
            continue
        sid = str(row["source_id"] or "")
        if ":chunk:" in sid:
            continue
        cand = docs / f"{row['source']}_{sid}.pdf"
        matches = list(docs.glob(f"{row['source']}_*{sid[:40]}*.pdf")) if sid else []
        chosen = cand if cand.is_file() else (matches[0] if matches else None)
        if not chosen:
            continue
        meta["document_path"] = str(chosen)
        conn.execute(
            "UPDATE harvest_items SET meta_json=? WHERE id=?",
            (json.dumps(meta, ensure_ascii=False), row["id"]),
        )
        n += 1
        print("linked", row["id"], chosen.name)
    conn.commit()
    print("linked_total", n)
    print([p.name for p in sorted(docs.glob("*.pdf"))])
    conn.close()


if __name__ == "__main__":
    main()
