"""Digital Giza / Giza Project best-effort connector."""
from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, List, Optional

from .base import http_get, polite_sleep, query_pack_for_site

CONNECTOR_ID = "digital_giza"
BASE = "https://giza.fas.harvard.edu"


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Best-effort: harvest catalog-link records from Digital Giza search HTML.
    Only active for giza focus (or unscoped). Does not invent transcriptions.
    """
    errors = errors if errors is not None else []
    site_id = (site or {}).get("id")
    if site_id and site_id != "giza":
        return []

    out: List[Dict[str, Any]] = []
    packs = query_pack_for_site(site, query or "Giza")
    seen: set = set()

    for q in packs:
        if len(out) >= limit:
            break
        # Site search endpoint (HTML). If shape changes, record error and continue.
        url = f"{BASE}/search?search_api_fulltext={urllib.parse.quote(q)}"
        try:
            html = http_get(url, timeout=25.0).decode("utf-8", errors="replace")
        except Exception as exc:
            errors.append(f"digital_giza_search:{q}:{exc}")
            # Fallback: seed a single catalog anchor for the site when search fails
            if not out:
                out.append(
                    {
                        "source": CONNECTOR_ID,
                        "source_id": "giza-project-home",
                        "source_url": BASE + "/",
                        "title": "Digital Giza / Giza Project (catalog hub)",
                        "culture": "egyptian",
                        "official_text": (
                            "Digital Giza (Harvard) — Giza Plateau catalog hub. "
                            f"Search query attempted: {q}. Browse for mastaba/pyramid documentation."
                        ),
                        "image_url": "",
                        "site": "giza",
                        "period": "Old Kingdom",
                        "license": "See Digital Giza site terms",
                        "connector": CONNECTOR_ID,
                        "is_stub": False,
                        "meta_extra": {"query": q, "mode": "hub_fallback"},
                        "allow_without_image": True,
                    }
                )
            continue

        # Extract relative/absolute links that look like site/object pages
        hrefs = re.findall(r'href="(/sites/[^"]+|/fullobjects/[^"]+|/library/[^"]+)"', html, flags=re.I)
        titles = re.findall(r"<h[23][^>]*>(.*?)</h[23]>", html, flags=re.I | re.S)
        # Clean titles
        clean_titles = [re.sub(r"<[^>]+>", "", t).strip() for t in titles]
        for i, href in enumerate(hrefs):
            if len(out) >= limit:
                break
            if href in seen:
                continue
            seen.add(href)
            full = href if href.startswith("http") else (BASE + href)
            title = clean_titles[i] if i < len(clean_titles) else href.strip("/").split("/")[-1]
            title = re.sub(r"\s+", " ", title)[:200] or href
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": href.strip("/").replace("/", "_")[:120],
                    "source_url": full,
                    "title": f"Digital Giza: {title}",
                    "culture": "egyptian",
                    "official_text": (
                        f"Digital Giza catalog entry.\nTitle: {title}\nURL: {full}\nQuery: {q}"
                    ),
                    "image_url": "",
                    "site": "giza",
                    "period": "Old Kingdom",
                    "license": "See Digital Giza site terms",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "meta_extra": {"query": q},
                    "allow_without_image": True,
                }
            )
        polite_sleep(0.4)

    return out[:limit]
