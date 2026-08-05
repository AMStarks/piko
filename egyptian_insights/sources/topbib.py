"""Topographical Bibliography (TopBib / Griffith Institute) search connector."""
from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, List, Optional

from .base import http_get_json, polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "topbib"
BASE = "https://topbib.griffith.ox.ac.uk"


def _search_ids(title: str = "", name: str = "") -> List[str]:
    params = urllib.parse.urlencode(
        {
            "title": title or " ",
            "usernotes": " ",
            "editornotes": " ",
            "name": name or " ",
            "identifier": " ",
            "type": "any",
            "published": "any",
        }
    )
    data = http_get_json(f"{BASE}/record/search?{params}", timeout=30.0)
    return [str(x) for x in (data.get("ids") or []) if x]


def _fetch_fields(record_id: str) -> Dict[str, Any]:
    params = urllib.parse.urlencode({"id": record_id})
    return http_get_json(f"{BASE}/record/fields?{params}", timeout=30.0)


def _format_record(rec: Dict[str, Any]) -> str:
    ancestors = rec.get("ancestors") or []
    path = " › ".join(str(a.get("title") or "") for a in ancestors if isinstance(a, dict) and a.get("title"))
    printed = rec.get("printed_source") or {}
    if isinstance(printed, list):
        printed = printed[0] if printed and isinstance(printed[0], dict) else {}
    if not isinstance(printed, dict):
        printed = {}
    notes = rec.get("user_notes") or []
    if isinstance(notes, str):
        notes = [notes]
    parts = [
        str(rec.get("title") or ""),
        f"Path: {path}" if path else "",
        f"Type: {rec.get('type')}" if rec.get("type") else "",
        f"Identifier: {rec.get('identifier')}" if rec.get("identifier") else "",
        (
            f"Printed: vol {printed.get('volume')} pp. {printed.get('first_page')}–{printed.get('last_page')}"
            if printed.get("volume") is not None
            else ""
        ),
        f"Date: {rec.get('date_str')}" if rec.get("date_str") else "",
        ("Notes: " + "; ".join(str(n) for n in notes)) if notes else "",
    ]
    return "\n".join(p for p in parts if p)


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Search TopBib advanced record API and fetch public field records.
    Bibliographic / topographic entries — not full PDFs (login-gated allfields).
    """
    errors = errors if errors is not None else []
    out: List[Dict[str, Any]] = []
    seen: set = set()
    packs = query_pack_for_site(site, query)
    # Prefer short place-name queries for TopBib title search
    if site:
        aliases = [str(site.get("label") or "")] + [str(a) for a in (site.get("aliases") or [])]
        packs = [a for a in aliases if a and a.lower() not in ("on",)] + packs
    # TopBib title search wants short tokens — drop composite labels / punctuation-heavy strings
    cleaned: List[str] = []
    seen_q: set = set()
    for q in packs:
        q = str(q).strip()
        if not q or "/" in q or len(q) > 48:
            # Prefer first meaningful token from long labels
            for part in re.split(r"[/,;|]+", q):
                part = part.strip()
                if 2 <= len(part) <= 40 and part.lower() not in seen_q:
                    seen_q.add(part.lower())
                    cleaned.append(part)
            continue
        key = q.lower()
        if key in seen_q:
            continue
        seen_q.add(key)
        cleaned.append(q)
    packs = cleaned

    for q in packs:
        if len(out) >= limit:
            break
        q = str(q).strip()
        if not q:
            continue
        try:
            polite_sleep(0.35)
            ids = _search_ids(title=q)
            if not ids:
                ids = _search_ids(name=q)
        except Exception as exc:
            errors.append(f"topbib_search:{q}:{exc}")
            continue

        for rid in ids:
            if len(out) >= limit:
                break
            if rid in seen:
                continue
            seen.add(rid)
            polite_sleep(0.25)
            try:
                rec = _fetch_fields(rid)
            except Exception as exc:
                errors.append(f"topbib_fields:{rid}:{exc}")
                continue
            title = str(rec.get("title") or rid)
            text = _format_record(rec)
            blob = text + " " + " ".join(
                str(a.get("title") or "") for a in (rec.get("ancestors") or [])
            )
            if site and not text_matches_site(blob + " " + q, site):
                # Title search already targeted the place; keep if query term appears
                if q.lower() not in blob.lower() and q.lower() not in title.lower():
                    continue
            ident = str(rec.get("identifier") or rid)
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": rid,
                    "source_url": f"{BASE}/database.html#{ident}",
                    "title": title,
                    "culture": "egyptian",
                    "official_text": text,
                    "image_url": "",
                    "site": (site or {}).get("id"),
                    "period": str(rec.get("date_str") or ""),
                    "license": "Topographical Bibliography / Griffith Institute — bibliographic reference",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "allow_without_image": True,
                    "meta_extra": {
                        "kind": "literature",
                        "literature_role": "bibliography",
                        "topbib_type": rec.get("type"),
                        "topbib_identifier": ident,
                        "printed_source": rec.get("printed_source"),
                        "query": q,
                    },
                }
            )
    return out[:limit]
