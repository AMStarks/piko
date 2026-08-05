"""Harvest open digital sources into the cultures cache (connector router)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import db
from . import research_goal
from .sources import run_connectors
from .sources.base import MIN_IMAGE_BYTES, download_bytes, download_document

_SAMPLES = Path(__file__).resolve().parent / "assets" / "samples"


def _safe_name(value: str) -> str:
    import re

    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value)[:120] or "item"


def _local_sample(name: str) -> Optional[str]:
    p = _SAMPLES / name
    return str(p) if p.exists() else None


def _resolve_focus(data: Dict[str, Any]) -> Optional[str]:
    focus = data.get("focus") or data.get("site")
    if focus:
        site = research_goal.resolve_site(str(focus))
        return str(site["id"]) if site else str(focus)
    note = str(data.get("note") or data.get("brief") or "")
    # Prefer explicit meta.site=
    import re

    m = re.search(r"meta\.site\s*=\s*([a-z0-9_-]+)", note, flags=re.I)
    if m:
        site = research_goal.resolve_site(m.group(1))
        if site:
            return str(site["id"])
    # Unique alias hit only (do not prefer first of many)
    hits = []
    lower = note.lower()
    for site_id in research_goal.site_ids():
        site = research_goal.resolve_site(site_id) or {}
        aliases = [site_id] + [str(a).lower() for a in (site.get("aliases") or [])]
        if any(a and a in lower for a in aliases if a and a != "on"):
            hits.append(site_id)
    if len(hits) == 1:
        return hits[0]
    return None


def _persist_item(
    conn: Any,
    row: Dict[str, Any],
    *,
    focus: Optional[str],
    query: str,
    require_image: bool,
    require_document: bool = False,
    errors: List[str],
) -> Optional[Dict[str, Any]]:
    is_stub = bool(row.get("is_stub"))
    image_path = None
    image_bytes = 0
    image_url = str(row.get("image_url") or "")

    # Skip re-download when this volume title (or URL) already exists in the corpus
    title_hit = db.find_title_match(
        conn,
        row.get("title"),
        source_url=row.get("source_url") or row.get("document_url"),
    )
    if title_hit:
        same_key = (
            str(title_hit.get("source") or "") == str(row.get("source") or "")
            and str(title_hit.get("source_id") or "") == str(row.get("source_id") or "")
        )
        try:
            hit_meta = json.loads(title_hit.get("meta_json") or "{}") or {}
        except Exception:
            hit_meta = {}
        has_doc = bool(hit_meta.get("document_path"))
        # Different source/id but same title (and we already have a file): keep first id
        if not same_key and has_doc:
            errors.append(
                f"title_dup:#{title_hit['id']}:{row.get('source')}:{row.get('source_id')}"
            )
            text_chars = len(str(row.get("official_text") or title_hit.get("official_text") or ""))
            return {
                "harvest_id": int(title_hit["id"]),
                "site": hit_meta.get("site") or focus,
                "source": title_hit.get("source"),
                "source_id": title_hit.get("source_id"),
                "title": title_hit.get("title") or row.get("title"),
                "image_path": title_hit.get("image_path"),
                "document_path": hit_meta.get("document_path"),
                "source_url": title_hit.get("source_url") or row.get("source_url"),
                "is_stub": False,
                "image_bytes": int(hit_meta.get("image_bytes") or 0),
                "text_chars": text_chars,
                "kind": hit_meta.get("kind") or (row.get("meta_extra") or {}).get("kind"),
                "connector": hit_meta.get("connector") or row.get("connector") or row.get("source"),
                "title_deduped": True,
                "matched_existing_id": int(title_hit["id"]),
            }

    if image_url:
        dest = db.images_dir() / f"{_safe_name(row['source'])}_{_safe_name(str(row['source_id']))}.jpg"
        candidates = [image_url]
        if row.get("image_url_alt"):
            candidates.append(str(row["image_url_alt"]))
        referer = str(row.get("download_referer") or "")
        data = None
        for cand in candidates:
            data = download_bytes(cand, referer=referer)
            if data and len(data) >= MIN_IMAGE_BYTES:
                image_url = cand
                break
            data = None
        if data and len(data) >= MIN_IMAGE_BYTES:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            image_path = str(dest)
            image_bytes = len(data)
        elif data:
            errors.append(f"image_too_small:{row.get('source_id')}:{len(data)}")
        else:
            errors.append(f"image_download_failed:{row.get('source_id')}")

    if not image_path and is_stub and row.get("local_sample"):
        local = _local_sample(str(row["local_sample"]))
        if local:
            dest = db.images_dir() / f"{_safe_name(row['source'])}_{_safe_name(str(row['source_id']))}.jpg"
            try:
                raw = Path(local).read_bytes()
                dest.write_bytes(raw)
                image_path = str(dest)
                image_bytes = len(raw)
            except Exception as exc:
                errors.append(f"local_sample_copy_failed:{row.get('source_id')}:{exc}")

    document_path = None
    document_bytes = 0
    document_url = str(row.get("document_url") or "")
    # Connector already wrote the document locally (e.g. web_text site scrape).
    local_doc = str(row.get("document_local_path") or "")
    if local_doc:
        lp = Path(local_doc)
        if lp.exists() and lp.is_file() and lp.stat().st_size > 500:
            document_path = str(lp)
            document_bytes = lp.stat().st_size
        else:
            errors.append(f"document_local_missing:{row.get('source_id')}")
    if document_url and not document_path:
        ext = str(row.get("document_ext") or ".pdf")
        if not ext.startswith("."):
            ext = "." + ext
        dest = db.documents_dir() / f"{_safe_name(row['source'])}_{_safe_name(str(row['source_id']))}{ext}"
        referer = str(row.get("download_referer") or row.get("source_url") or "")
        doc = download_document(document_url, referer=referer)
        if doc and len(doc) > 500:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(doc)
            document_path = str(dest)
            document_bytes = len(doc)
        elif doc:
            errors.append(f"document_too_small:{row.get('source_id')}:{len(doc)}")
        else:
            errors.append(f"document_download_failed:{row.get('source_id')}")

    allow_without = bool(row.get("allow_without_image"))
    if require_image and not image_path and not allow_without:
        return None
    if require_image and image_path and image_bytes < MIN_IMAGE_BYTES and not is_stub and not allow_without:
        # Non-stub smoke-sized images do not count as live
        return None
    if require_document and not document_path:
        # URL alone is not enough — volume jobs need a local file
        errors.append(f"require_document_missing:{row.get('source')}:{row.get('source_id')}")
        return None

    goal = research_goal.load_goal()
    site_id = row.get("site") or focus
    meta_extra = dict(row.get("meta_extra") or {})
    meta = {
        "query": query,
        "harvest": "phase1_connectors",
        "research_goal_id": goal.get("id"),
        "site": site_id,
        "period": row.get("period"),
        "focus": focus,
        "connector": row.get("connector") or row.get("source"),
        "license": row.get("license"),
        "is_stub": is_stub,
        "image_bytes": image_bytes,
        "kind": meta_extra.get("kind") or ("literature" if allow_without and not image_url else "object"),
        **meta_extra,
    }
    if document_path:
        meta["document_path"] = document_path
        meta["document_bytes"] = document_bytes
        meta["document_url"] = document_url or None
    try:
        from .author_meta import enrich_meta
        meta, _authors, _changed = enrich_meta(
            meta,
            str(row.get("title") or ""),
            query=str(query or row.get("query") or ""),
            source="harvest_ingest",
        )
    except Exception:
        pass
    payload = {
        "source": row.get("source") or "unknown",
        "source_id": str(row.get("source_id") or ""),
        "source_url": row.get("source_url"),
        "title": row.get("title"),
        "culture": row.get("culture") or "egyptian",
        "official_text": row.get("official_text"),
        "image_path": image_path,
        "image_url": image_url or None,
        "meta_json": json.dumps(meta, ensure_ascii=False),
    }
    hid = db.upsert_harvest(conn, payload)
    text_chars = len(str(row.get("official_text") or ""))
    title_deduped = bool(title_hit and int(title_hit["id"]) == int(hid) and (
        str(title_hit.get("source") or "") != payload["source"]
        or str(title_hit.get("source_id") or "") != payload["source_id"]
    ))
    return {
        "harvest_id": hid,
        "site": site_id,
        "source": payload["source"],
        "source_id": payload["source_id"],
        "title": payload["title"],
        "image_path": image_path,
        "document_path": document_path,
        "source_url": payload["source_url"],
        "is_stub": is_stub,
        "image_bytes": image_bytes,
        "text_chars": text_chars,
        "kind": meta.get("kind"),
        "connector": meta["connector"],
        "title_deduped": title_deduped,
        "matched_existing_id": int(title_hit["id"]) if title_deduped and title_hit else None,
    }


def run_harvest(input_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = input_data or {}
    focus = _resolve_focus(data)
    site = research_goal.resolve_site(focus) if focus else None
    query = str(data.get("query") or "").strip() or research_goal.default_query(focus)
    limit = int(data.get("limit") if data.get("limit") is not None else (research_goal.load_goal().get("default_harvest_limit") or 15))
    limit = max(1, min(limit, 40))
    allow_stubs = bool(data.get("allow_stubs"))
    require_image = data.get("require_image")
    if require_image is None:
        require_image = True
    require_image = bool(require_image)
    sources = data.get("sources")
    if isinstance(sources, str):
        sources = [s.strip() for s in sources.split(",") if s.strip()]
    if not sources:
        sources = research_goal.load_goal().get("phase1_connectors") or [
            "met",
            "commons",
            "artic",
            "digital_giza",
            "archive_org",
            "topbib",
            "tla",
        ]

    routed = run_connectors(
        site=site,
        limit=limit,
        query=query,
        sources=list(sources),
        allow_stubs=allow_stubs,
    )
    errors: List[str] = list(routed.get("errors") or [])
    connector_stats = dict(routed.get("connector_stats") or {})

    skip_thin = bool(data.get("skip_thin"))
    min_text = int(data.get("min_text_chars") if data.get("min_text_chars") is not None else 500)
    min_text = max(100, min(min_text, 5000))
    require_document = bool(data.get("require_document"))
    scout_only = list(sources) == ["source_scout"]

    def _row_too_thin(row: Dict[str, Any]) -> bool:
        kind = str((row.get("meta_extra") or {}).get("kind") or "")
        text_chars = len(str(row.get("official_text") or ""))
        has_doc = bool(row.get("document_url") or row.get("document_path"))
        if require_document and not has_doc:
            return True
        if not skip_thin:
            return False
        if kind == "source_candidate" and not scout_only:
            return True
        if kind == "literature" and not has_doc and text_chars < min_text:
            return True
        return False

    conn = db.connect()
    saved: List[Dict[str, Any]] = []
    for row in routed.get("items") or []:
        try:
            if _row_too_thin(row):
                errors.append(f"skip_thin:{row.get('source')}:{row.get('source_id')}")
                continue
            persisted = _persist_item(
                conn,
                row,
                focus=focus,
                query=query,
                require_image=require_image,
                require_document=require_document,
                errors=errors,
            )
            if persisted:
                saved.append(persisted)
        except Exception as exc:
            errors.append(f"persist:{row.get('source_id')}:{exc}")
    stats = db.stats(conn)
    conn.close()

    live = [s for s in saved if not s.get("is_stub")]
    stubs = [s for s in saved if s.get("is_stub")]
    live_count = len(live)
    stub_count = len(stubs)
    ok = live_count > 0
    quality = _quality_summary(saved)

    return {
        "ok": ok,
        "source": "phase1_connectors",
        "query": query,
        "focus": focus,
        "research_goal_id": research_goal.load_goal().get("id"),
        "count": len(saved),
        "live_count": live_count,
        "stub_count": stub_count,
        "allow_stubs": allow_stubs,
        "require_image": require_image,
        "connector_stats": connector_stats,
        "quality": quality,
        "items": saved,
        "errors": errors,
        "stats": stats,
        "db": str(db.db_path()),
    }


def _quality_summary(saved: List[Dict[str, Any]]) -> Dict[str, Any]:
    lit = cand = obj = substantive = thin = with_doc = 0
    text_lens: List[int] = []
    for s in saved or []:
        kind = str(s.get("kind") or "object")
        chars = int(s.get("text_chars") or 0)
        text_lens.append(chars)
        has_doc = bool(s.get("document_path"))
        if has_doc:
            with_doc += 1
        if kind == "literature":
            lit += 1
        elif kind == "source_candidate":
            cand += 1
        else:
            obj += 1
        if kind == "source_candidate":
            thin += 1
        elif has_doc or chars >= 500 or (
            kind == "object"
            and s.get("image_path")
            and int(s.get("image_bytes") or 0) >= MIN_IMAGE_BYTES
        ):
            substantive += 1
        else:
            thin += 1
    return {
        "substantive_count": substantive,
        "thin_count": thin,
        "literature_count": lit,
        "candidate_count": cand,
        "object_count": obj,
        "with_document": with_doc,
        "max_text_chars": max(text_lens) if text_lens else 0,
        "avg_text_chars": int(sum(text_lens) / len(text_lens)) if text_lens else 0,
    }
