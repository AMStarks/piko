"""Egyptian Insights — isolated cultures cache (SQLite)."""
from __future__ import annotations

import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

def data_root() -> Path:
    root = Path(
        os.getenv("EGYPTIAN_INSIGHTS_DATA_DIR")
        or os.getenv("PIKO_EGYPTIAN_DATA_DIR")
        or Path(__file__).resolve().parent.parent / "data" / "egyptian-insights"
    )
    root.mkdir(parents=True, exist_ok=True)
    (root / "assets" / "images").mkdir(parents=True, exist_ok=True)
    return root


def db_path() -> Path:
    return data_root() / "cultures_cache.sqlite"


def merge_locked_meta(old_meta: Optional[Dict[str, Any]], new_meta: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep PM/spine thread locks across recrawl, merge, and ON CONFLICT."""
    old = dict(old_meta or {})
    merged = dict(new_meta or {})
    pm_locked = bool(old.get("pm_confirmed") or old.get("pm_confirm_id") or old.get("spine_retag"))
    if pm_locked or (old.get("thread") and not merged.get("thread")):
        if old.get("thread"):
            merged["thread"] = old["thread"]
        if old.get("site"):
            merged["site"] = old["site"]
    if pm_locked:
        merged["pm_confirmed"] = True
        if old.get("pm_confirm_id"):
            merged["pm_confirm_id"] = old["pm_confirm_id"]
        if old.get("spine_retag"):
            merged["spine_retag"] = old["spine_retag"]
    return merged


def images_dir() -> Path:
    p = data_root() / "assets" / "images"
    p.mkdir(parents=True, exist_ok=True)
    return p


def documents_dir() -> Path:
    p = data_root() / "assets" / "documents"
    p.mkdir(parents=True, exist_ok=True)
    return p


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path()))
    conn.row_factory = sqlite3.Row
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS harvest_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          source_id TEXT,
          source_url TEXT,
          title TEXT,
          culture TEXT,
          official_text TEXT,
          image_path TEXT,
          image_url TEXT,
          meta_json TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(source, source_id)
        );
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          harvest_id INTEGER NOT NULL,
          model TEXT,
          raw_json TEXT,
          gardiner_tokens TEXT,
          confidence REAL,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY(harvest_id) REFERENCES harvest_items(id)
        );
        CREATE TABLE IF NOT EXISTS critiques (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          harvest_id INTEGER NOT NULL,
          transcription_id INTEGER,
          model TEXT,
          review_markdown TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY(harvest_id) REFERENCES harvest_items(id),
          FOREIGN KEY(transcription_id) REFERENCES transcriptions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_harvest_source ON harvest_items(source, source_id);
        CREATE INDEX IF NOT EXISTS idx_transcriptions_harvest ON transcriptions(harvest_id);
        """
    )
    conn.commit()


def normalize_title(title: Optional[str]) -> str:
    """Fold titles for corpus dedupe (case, punctuation, PDF noise)."""
    s = str(title or "").strip().lower()
    if not s:
        return ""
    s = re.sub(r"\.pdf\b", " ", s)
    s = re.sub(r"\bpdf\b", " ", s)
    s = re.sub(r"https?://\S+", " ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    # Drop leading articles after fold
    s = re.sub(r"^(the|a|an)\s+", "", s)
    return s


def titles_match(a: Optional[str], b: Optional[str]) -> bool:
    """True when titles are the same work (exact fold or near-containment)."""
    na = normalize_title(a)
    nb = normalize_title(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    # Containment only when both are substantial and the shorter is mostly inside the longer
    if len(na) < 18 or len(nb) < 18:
        return False
    shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
    if shorter not in longer:
        return False
    return (len(shorter) / max(len(longer), 1)) >= 0.78


def find_title_match(
    conn: sqlite3.Connection,
    title: Optional[str],
    *,
    exclude_id: Optional[int] = None,
    source_url: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Find an existing harvest row that is the same volume by title (or exact source_url).
    Prefer literature/kind-matching rows when meta is present; otherwise first title hit.
    """
    want_url = str(source_url or "").strip()
    if want_url:
        url_row = conn.execute(
            "SELECT * FROM harvest_items WHERE source_url = ? LIMIT 1",
            (want_url,),
        ).fetchone()
        if url_row and (exclude_id is None or int(url_row["id"]) != int(exclude_id)):
            return dict(url_row)

    if not normalize_title(title):
        return None

    rows = conn.execute(
        "SELECT id, source, source_id, source_url, title, image_path, meta_json, official_text FROM harvest_items ORDER BY id ASC"
    ).fetchall()
    lit_hit: Optional[Dict[str, Any]] = None
    any_hit: Optional[Dict[str, Any]] = None
    for row in rows:
        if exclude_id is not None and int(row["id"]) == int(exclude_id):
            continue
        if not titles_match(title, row["title"]):
            continue
        d = dict(row)
        kind = ""
        try:
            kind = str((json.loads(d.get("meta_json") or "{}") or {}).get("kind") or "")
        except Exception:
            kind = ""
        if kind == "literature" and lit_hit is None:
            lit_hit = d
        if any_hit is None:
            any_hit = d
        if lit_hit:
            break
    return lit_hit or any_hit


def upsert_harvest(conn: sqlite3.Connection, row: Dict[str, Any], *, replace: bool = False) -> int:
    params = {
        "source": row.get("source") or "unknown",
        "source_id": row.get("source_id") or row.get("id") or "",
        "source_url": row.get("source_url"),
        "title": row.get("title"),
        "culture": row.get("culture") or "egyptian",
        "official_text": row.get("official_text"),
        "image_path": row.get("image_path"),
        "image_url": row.get("image_url"),
        "meta_json": row.get("meta_json"),
    }
    # Title / URL dedupe across sources: reuse existing id instead of a second volume row
    existing = find_title_match(
        conn,
        params.get("title"),
        source_url=params.get("source_url"),
    )
    if existing:
        same_key = (
            str(existing.get("source") or "") == params["source"]
            and str(existing.get("source_id") or "") == params["source_id"]
        )
        if replace:
            hid = int(existing["id"])
            try:
                old_meta = json.loads(existing.get("meta_json") or "{}") or {}
            except Exception:
                old_meta = {}
            try:
                new_meta = json.loads(params.get("meta_json") or "{}") or {}
            except Exception:
                new_meta = {}
            params["meta_json"] = json.dumps(merge_locked_meta(old_meta, new_meta), ensure_ascii=False)
            conn.execute(
                """
                UPDATE harvest_items SET
                  source=?,
                  source_id=?,
                  source_url=?,
                  title=?,
                  culture=?,
                  official_text=?,
                  image_path=COALESCE(?, image_path),
                  image_url=?,
                  meta_json=?
                WHERE id=?
                """,
                (
                    params["source"],
                    params["source_id"],
                    params.get("source_url"),
                    params.get("title"),
                    params.get("culture"),
                    params.get("official_text"),
                    params.get("image_path"),
                    params.get("image_url"),
                    params.get("meta_json"),
                    hid,
                ),
            )
            conn.commit()
            return hid
        if not same_key:
            # Merge onto the first-seen volume; keep original source/source_id as the corpus id
            hid = int(existing["id"])
            try:
                old_meta = json.loads(existing.get("meta_json") or "{}") or {}
            except Exception:
                old_meta = {}
            try:
                new_meta = json.loads(params.get("meta_json") or "{}") or {}
            except Exception:
                new_meta = {}
            aliases = list(old_meta.get("title_aliases") or [])
            alias = {
                "source": params["source"],
                "source_id": params["source_id"],
                "source_url": params.get("source_url"),
                "title": params.get("title"),
            }
            if alias not in aliases:
                aliases.append(alias)
            old_meta["title_aliases"] = aliases
            # Prefer keeping existing document_path; fill gaps from the new harvest
            for key in ("document_path", "document_url", "document_bytes", "kind", "connector"):
                if new_meta.get(key) and not old_meta.get(key):
                    old_meta[key] = new_meta[key]
            merged_meta = json.dumps({**new_meta, **old_meta}, ensure_ascii=False)
            conn.execute(
                """
                UPDATE harvest_items SET
                  source_url=COALESCE(?, source_url),
                  title=COALESCE(NULLIF(?, ''), title),
                  culture=COALESCE(?, culture),
                  official_text=CASE
                    WHEN length(COALESCE(?, '')) > length(COALESCE(official_text, '')) THEN ?
                    ELSE official_text
                  END,
                  image_path=COALESCE(image_path, ?),
                  image_url=COALESCE(?, image_url),
                  meta_json=?
                WHERE id=?
                """,
                (
                    params.get("source_url"),
                    params.get("title"),
                    params.get("culture"),
                    params.get("official_text"),
                    params.get("official_text"),
                    params.get("image_path"),
                    params.get("image_url"),
                    merged_meta,
                    hid,
                ),
            )
            conn.commit()
            return hid

    same_key_row = conn.execute(
        "SELECT id, meta_json FROM harvest_items WHERE source = ? AND source_id = ?",
        (params["source"], params["source_id"]),
    ).fetchone()
    if same_key_row:
        try:
            old_meta = json.loads(same_key_row["meta_json"] or "{}") or {}
        except Exception:
            old_meta = {}
        try:
            new_meta = json.loads(params.get("meta_json") or "{}") or {}
        except Exception:
            new_meta = {}
        params["meta_json"] = json.dumps(merge_locked_meta(old_meta, new_meta), ensure_ascii=False)

    conn.execute(
        """
        INSERT INTO harvest_items (source, source_id, source_url, title, culture, official_text, image_path, image_url, meta_json)
        VALUES (:source, :source_id, :source_url, :title, :culture, :official_text, :image_path, :image_url, :meta_json)
        ON CONFLICT(source, source_id) DO UPDATE SET
          source_url=excluded.source_url,
          title=excluded.title,
          culture=excluded.culture,
          official_text=excluded.official_text,
          image_path=COALESCE(excluded.image_path, harvest_items.image_path),
          image_url=excluded.image_url,
          meta_json=excluded.meta_json
        """,
        params,
    )
    hid = conn.execute(
        "SELECT id FROM harvest_items WHERE source = ? AND source_id = ?",
        (params["source"], params["source_id"]),
    ).fetchone()[0]
    conn.commit()
    return int(hid)


def insert_transcription(conn: sqlite3.Connection, harvest_id: int, payload: Dict[str, Any]) -> int:
    import json

    tokens = payload.get("gardiner_tokens") or []
    cur = conn.execute(
        """
        INSERT INTO transcriptions (harvest_id, model, raw_json, gardiner_tokens, confidence, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            harvest_id,
            payload.get("model"),
            json.dumps(payload.get("raw") or payload, ensure_ascii=False),
            ",".join(tokens) if isinstance(tokens, list) else str(tokens or ""),
            float(payload.get("confidence") or 0),
            payload.get("notes"),
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def insert_critique(
    conn: sqlite3.Connection,
    harvest_id: int,
    transcription_id: Optional[int],
    model: str,
    review_markdown: str,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO critiques (harvest_id, transcription_id, model, review_markdown)
        VALUES (?, ?, ?, ?)
        """,
        (harvest_id, transcription_id, model, review_markdown),
    )
    conn.commit()
    return int(cur.lastrowid)


def search_corpus(conn: sqlite3.Connection, query: str, limit: int = 20) -> List[Dict[str, Any]]:
    q = f"%{(query or '').strip()}%"
    rows = conn.execute(
        """
        SELECT h.id, h.source, h.source_id, h.title, h.source_url, h.image_path,
               (SELECT COUNT(*) FROM transcriptions t WHERE t.harvest_id = h.id) AS transcription_count,
               (SELECT COUNT(*) FROM critiques c WHERE c.harvest_id = h.id) AS critique_count
        FROM harvest_items h
        WHERE COALESCE(h.title,'') LIKE ?
           OR COALESCE(h.official_text,'') LIKE ?
           OR COALESCE(h.source_id,'') LIKE ?
           OR COALESCE(h.culture,'') LIKE ?
        ORDER BY h.id DESC
        LIMIT ?
        """,
        (q, q, q, q, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def resolve_image_path(stored: Optional[str]) -> Optional[str]:
    if not stored:
        return None
    p = Path(stored)
    if p.is_file():
        return str(p)
    # Paths written inside Docker (/data/egyptian-insights/...) or other hosts
    candidate = images_dir() / p.name
    if candidate.is_file():
        return str(candidate)
    return None


def get_harvest(conn: sqlite3.Connection, harvest_id: int) -> Optional[Dict[str, Any]]:
    row = conn.execute("SELECT * FROM harvest_items WHERE id = ?", (harvest_id,)).fetchone()
    if not row:
        return None
    out = dict(row)
    resolved = resolve_image_path(out.get("image_path"))
    if resolved:
        out["image_path"] = resolved
    return out


def latest_transcription(conn: sqlite3.Connection, harvest_id: int) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        "SELECT * FROM transcriptions WHERE harvest_id = ? ORDER BY id DESC LIMIT 1",
        (harvest_id,),
    ).fetchone()
    return dict(row) if row else None


def stats(conn: sqlite3.Connection) -> Dict[str, Any]:
    return {
        "harvest_items": conn.execute("SELECT COUNT(*) FROM harvest_items").fetchone()[0],
        "transcriptions": conn.execute("SELECT COUNT(*) FROM transcriptions").fetchone()[0],
        "critiques": conn.execute("SELECT COUNT(*) FROM critiques").fetchone()[0],
        "db_path": str(db_path()),
        "images_dir": str(images_dir()),
        "documents_dir": str(documents_dir()),
    }
