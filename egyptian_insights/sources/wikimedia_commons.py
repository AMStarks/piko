"""Wikimedia Commons API connector."""
from __future__ import annotations

import urllib.parse
from typing import Any, Dict, List, Optional

from .base import http_get_json, polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "commons"
API = "https://commons.wikimedia.org/w/api.php"


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
        # Bias toward Egyptian / hieroglyph material
        gsr = f"{q} Egypt"
        params = urllib.parse.urlencode(
            {
                "action": "query",
                "generator": "search",
                "gsrsearch": gsr,
                "gsrlimit": str(min(20, max(limit, 8))),
                "gsrnamespace": "6",  # File:
                "prop": "imageinfo",
                "iiprop": "url|size|extmetadata|mime",
                "iiurlwidth": "800",
                "format": "json",
            }
        )
        try:
            data = http_get_json(f"{API}?{params}", timeout=30.0)
        except Exception as exc:
            errors.append(f"commons_search:{q}:{exc}")
            continue
        pages = ((data.get("query") or {}).get("pages") or {})
        for page in pages.values():
            if len(out) >= limit:
                break
            title = str(page.get("title") or "")
            pageid = page.get("pageid")
            if pageid in seen:
                continue
            ii = (page.get("imageinfo") or [{}])[0]
            mime = str(ii.get("mime") or "")
            if mime and not mime.startswith("image/"):
                continue
            thumb = str(ii.get("thumburl") or "")
            full = str(ii.get("url") or "")
            # Prefer API thumb; fall back to original (skip SVG originals for vision later)
            if mime == "image/svg+xml":
                continue
            image_url = thumb or full
            if not image_url:
                continue
            meta = ii.get("extmetadata") or {}
            desc = ""
            if isinstance(meta, dict):
                desc = str((meta.get("ImageDescription") or {}).get("value") or "")
                license_name = str((meta.get("LicenseShortName") or {}).get("value") or "")
                artist = str((meta.get("Artist") or {}).get("value") or "")
            else:
                license_name = ""
                artist = ""
            blob = f"{title} {desc}"
            if site and site.get("id") == "heliopolis":
                bl = blob.lower()
                if "heliopolis" not in bl and "iunu" not in bl:
                    continue
                if not any(k in bl for k in ("egypt", "obelisk", "ancient", "temple", "ra ", "pharaoh", "hieroglyph")):
                    continue
            elif site and not text_matches_site(blob, site) and "egypt" not in blob.lower():
                continue
            elif site and not text_matches_site(blob, site):
                if not any(t.lower() in blob.lower() for t in (site.get("query_pack") or []) if t):
                    continue

            seen.add(pageid)
            source_url = f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
            official = "\n".join(
                x
                for x in (
                    title,
                    desc[:800] if desc else "",
                    f"Artist: {artist}" if artist else "",
                    f"License: {license_name}" if license_name else "",
                    f"URL: {source_url}",
                )
                if x
            )
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": str(pageid or title),
                    "source_url": source_url,
                    "title": title.replace("File:", ""),
                    "culture": "egyptian",
                    "official_text": official,
                    "image_url": image_url,
                    "site": (site or {}).get("id"),
                    "period": None,
                    "license": license_name or "Wikimedia Commons — see file page",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "meta_extra": {"query": gsr, "mime": mime},
                }
            )
            polite_sleep(0.2)
    return out[:limit]
