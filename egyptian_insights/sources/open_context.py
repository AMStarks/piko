"""Open Context archaeological records connector (JSON API).

Uses the public Open Context query API (ekansa/open-context-py stack).
Returns excavation / archive context records — primary archaeological
documentation, not literary corpora.

API: https://opencontext.org/about/services
"""
from __future__ import annotations

import urllib.parse
from typing import Any, Dict, List, Optional

from .base import http_get_json, polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "open_context"
BASE = "https://opencontext.org"


def _query(q: str, *, rows: int = 10) -> List[Dict[str, Any]]:
    params = urllib.parse.urlencode(
        {
            "q": q,
            "rows": max(1, min(50, rows)),
            "response": "uri-meta",
        }
    )
    url = f"{BASE}/query/.json?{params}"
    polite_sleep(0.35)
    data = http_get_json(url, timeout=45.0)
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        # alternate shapes
        for key in ("oc-api:has-results", "features", "results"):
            rows_list = data.get(key)
            if isinstance(rows_list, list):
                return [x for x in rows_list if isinstance(x, dict)]
    return []


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    errors = errors if errors is not None else []
    out: List[Dict[str, Any]] = []
    seen: set = set()
    packs = query_pack_for_site(site, query)
    if site:
        packs = [str(site.get("label") or "")] + [str(a) for a in (site.get("aliases") or [])] + packs
    packs = [p.strip() for p in packs if p and str(p).strip() and str(p).lower() != "on"]

    for q in packs:
        if len(out) >= limit:
            break
        # Bias toward Egypt when the query is a bare site name
        q_use = q
        if site and "egypt" not in q.lower():
            q_use = f"{q} Egypt"
        try:
            rows = _query(q_use, rows=max(limit, 8))
        except Exception as exc:
            errors.append(f"open_context:{q}:{exc}")
            continue
        if not rows:
            errors.append(f"open_context_empty:{q}")
            continue

        for row in rows:
            if len(out) >= limit:
                break
            href = str(row.get("href") or row.get("uri") or "").strip()
            label = str(row.get("label") or "").strip() or href
            key = href or label
            if not key or key in seen:
                continue
            context = str(row.get("context label") or row.get("context") or "")
            project = str(row.get("project label") or row.get("project") or "")
            category = str(row.get("item category") or row.get("category") or "")
            snippet = str(row.get("snippet") or "")
            # strip simple HTML marks from snippet
            snippet = snippet.replace("<mark>", "").replace("</mark>", "")
            blob = f"{label} {context} {project} {snippet}"
            if site and not text_matches_site(blob, site) and q.lower() not in blob.lower():
                continue
            seen.add(key)
            early = row.get("early bce/ce")
            late = row.get("late bce/ce")
            period = ""
            if early is not None or late is not None:
                period = f"{early}–{late}"
            official = "\n".join(
                x
                for x in (
                    label,
                    f"Project: {project}" if project else "",
                    f"Context: {context}" if context else "",
                    f"Category: {category}" if category else "",
                    f"Period (BCE/CE): {period}" if period else "",
                    snippet[:600] if snippet else "",
                    f"Open Context: {href}",
                )
                if x
            )
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": (href.split("/")[-1] if href else label)[:120],
                    "source_url": href or BASE,
                    "title": label[:240],
                    "culture": "egyptian",
                    "official_text": official[:6000],
                    "image_url": str(row.get("icon") or ""),
                    "site": context or (site or {}).get("id") or "",
                    "period": period,
                    "license": "Open Context — see record and project licenses",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "allow_without_image": True,
                    "meta_extra": {
                        "kind": "archaeology",
                        "literature_role": "open_context_record",
                        "provider": "opencontext.org",
                        "project": project,
                    },
                }
            )
    return out[:limit]
