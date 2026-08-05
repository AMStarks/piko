"""Art Institute of Chicago API connector."""
from __future__ import annotations

import urllib.parse
from typing import Any, Dict, List, Optional

from .base import http_get_json, polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "artic"
SEARCH = "https://api.artic.edu/api/v1/artworks/search"
IIIF = "https://www.artic.edu/iiif/2"


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
    fields = "id,title,image_id,date_display,place_of_origin,is_public_domain,department_title,artist_display,artwork_type_title"

    for q in packs:
        if len(out) >= limit:
            break
        params = urllib.parse.urlencode(
            {
                "q": q,
                "limit": str(min(20, max(limit, 8))),
                "fields": fields,
            }
        )
        try:
            data = http_get_json(f"{SEARCH}?{params}", timeout=25.0)
        except Exception as exc:
            errors.append(f"artic_search:{q}:{exc}")
            continue
        for row in data.get("data") or []:
            if len(out) >= limit:
                break
            oid = row.get("id")
            if oid in seen:
                continue
            title = str(row.get("title") or "")
            place = str(row.get("place_of_origin") or "")
            dept = str(row.get("department_title") or "")
            blob = f"{title} {place} {dept} {row.get('artist_display') or ''}"
            is_egypt = "egypt" in blob.lower() or "egyptian" in blob.lower() or "arts of africa" in dept.lower()
            if not is_egypt and site and not text_matches_site(blob, site):
                continue
            if site and not text_matches_site(blob, site) and not is_egypt:
                continue
            if site and is_egypt and not text_matches_site(blob, site):
                # keep only if query term matches
                if not any(t.lower() in blob.lower() for t in (site.get("query_pack") or []) if t):
                    continue
            image_id = row.get("image_id")
            if not image_id:
                continue
            if row.get("is_public_domain") is False:
                # still allow if public domain unknown; prefer PD
                pass
            image_url = f"{IIIF}/{image_id}/full/843,/0/default.jpg"
            # Also try laconic CDN pattern used by ARTIC website
            alt_image = f"https://www.artic.edu/iiif/2/{image_id}/full/!800,800/0/default.jpg"
            seen.add(oid)
            source_url = f"https://www.artic.edu/artworks/{oid}"
            official = "\n".join(
                x
                for x in (
                    title,
                    f"Place: {place}" if place else "",
                    f"Date: {row.get('date_display')}" if row.get("date_display") else "",
                    f"Artist: {row.get('artist_display')}" if row.get("artist_display") else "",
                    f"Department: {dept}" if dept else "",
                    f"URL: {source_url}",
                )
                if x
            )
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": str(oid),
                    "source_url": source_url,
                    "title": title or f"ARTIC {oid}",
                    "culture": "egyptian",
                    "official_text": official,
                    "image_url": image_url,
                    "image_url_alt": alt_image,
                    "site": (site or {}).get("id"),
                    "period": row.get("date_display"),
                    "license": "Public Domain" if row.get("is_public_domain") else "ARTIC terms — see object page",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "meta_extra": {"query": q, "image_id": image_id},
                    "download_referer": "https://www.artic.edu/",
                }
            )
            polite_sleep(0.2)
    return out[:limit]
