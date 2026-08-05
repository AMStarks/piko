"""Met Museum Collection API connector."""
from __future__ import annotations

import urllib.parse
from typing import Any, Dict, List, Optional

from .base import http_get_json, polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "met"
SEARCH = "https://collectionapi.metmuseum.org/public/collection/v1/search"
OBJECT = "https://collectionapi.metmuseum.org/public/collection/v1/objects"


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

    for q in packs:
        if len(out) >= limit:
            break
        try:
            params = urllib.parse.urlencode({"q": q, "hasImages": "true"})
            data = http_get_json(f"{SEARCH}?{params}", timeout=25.0)
        except Exception as exc:
            errors.append(f"met_search:{q}:{exc}")
            continue
        ids = list(data.get("objectIDs") or [])[: max(limit * 3, 20)]
        for oid in ids:
            if len(out) >= limit:
                break
            if oid in seen:
                continue
            seen.add(oid)
            polite_sleep(0.25)
            try:
                obj = http_get_json(f"{OBJECT}/{oid}", timeout=25.0)
            except Exception as exc:
                errors.append(f"met_object:{oid}:{exc}")
                continue
            title = str(obj.get("title") or "")
            place = " ".join(
                str(x)
                for x in (
                    obj.get("culture"),
                    obj.get("period"),
                    obj.get("dynasty"),
                    obj.get("excavation"),
                    obj.get("geography"),
                    obj.get("city"),
                    obj.get("locale"),
                    obj.get("creditLine"),
                    title,
                )
                if x
            )
            dept = str(obj.get("department") or "")
            is_egypt = "egypt" in dept.lower() or "egypt" in place.lower() or "egyptian" in place.lower()
            if not is_egypt:
                continue
            if site and not text_matches_site(place + " " + title, site):
                continue

            image_url = str(obj.get("primaryImageSmall") or obj.get("primaryImage") or "")
            if not image_url:
                continue

            official_parts = [
                title,
                f"Culture: {obj.get('culture')}" if obj.get("culture") else "",
                f"Period: {obj.get('period')}" if obj.get("period") else "",
                f"Dynasty: {obj.get('dynasty')}" if obj.get("dynasty") else "",
                f"Geography: {obj.get('geography') or obj.get('city') or ''}".strip(),
                f"Credit: {obj.get('creditLine')}" if obj.get("creditLine") else "",
                f"URL: {obj.get('objectURL')}" if obj.get("objectURL") else "",
            ]
            official = "\n".join(x for x in official_parts if x and x != "Geography: ")
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": str(oid),
                    "source_url": obj.get("objectURL") or f"https://www.metmuseum.org/art/collection/search/{oid}",
                    "title": title or f"Met object {oid}",
                    "culture": "egyptian",
                    "official_text": official,
                    "image_url": image_url,
                    "site": (site or {}).get("id"),
                    "period": obj.get("period"),
                    "license": "Public Domain" if obj.get("isPublicDomain") else "Met terms — see object page",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "meta_extra": {"department": dept, "query": q},
                }
            )
    return out[:limit]
