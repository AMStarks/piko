"""Thesaurus Linguae Aegyptiae (TLA) object-search connector (HTML harvest)."""
from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from .base import http_get, polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "tla"
BASE = "https://thesaurus-linguae-aegyptiae.de"


def _clean(html_frag: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html_frag or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_object_results(html: str) -> List[Tuple[str, str]]:
    """Return (object_id, title) pairs from TLA object search HTML."""
    # Prefer titled headings near object links
    pairs: List[Tuple[str, str]] = []
    seen: set = set()
    # Match object detail links (exclude trees/search)
    for m in re.finditer(
        r'href="(/object/([A-Z0-9]{10,}))"[^>]*>(.*?)</a>',
        html,
        flags=re.I | re.S,
    ):
        oid = m.group(2)
        label = _clean(m.group(3))
        if oid in seen or oid.lower() in ("trees", "search"):
            continue
        seen.add(oid)
        pairs.append((oid, label or oid))

    # Also scoop h-tag titles that mention objects when link text is weak
    if not pairs:
        for m in re.finditer(r"/object/([A-Z0-9]{10,})", html, flags=re.I):
            oid = m.group(1)
            if oid not in seen:
                seen.add(oid)
                pairs.append((oid, oid))
    return pairs


def _fetch_object_blurb(object_id: str) -> str:
    try:
        html = http_get(f"{BASE}/object/{object_id}", timeout=30.0).decode("utf-8", errors="replace")
    except Exception:
        return ""
    title = ""
    tm = re.search(r"<title>(.*?)</title>", html, flags=re.I | re.S)
    if tm:
        title = _clean(tm.group(1))
    # Grab a few descriptive paragraphs / dts
    bits = []
    for m in re.finditer(r"<(?:p|dd|li|h2|h3)[^>]*>(.*?)</(?:p|dd|li|h2|h3)>", html, flags=re.I | re.S):
        t = _clean(m.group(1))
        if 20 <= len(t) <= 500 and "cookie" not in t.lower():
            bits.append(t)
        if len(bits) >= 6:
            break
    body = "\n".join(bits[:6])
    return f"{title}\n{body}".strip()


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Search TLA object index via public HTML search pages.
    Stores object catalogue references (text corpus pointers), not full lemma dumps.
    """
    errors = errors if errors is not None else []
    out: List[Dict[str, Any]] = []
    seen: set = set()
    packs = query_pack_for_site(site, query)
    if site:
        aliases = [str(a) for a in (site.get("aliases") or []) if a and str(a).lower() not in ("on",)]
        label = str(site.get("label") or "")
        packs = ([label] if label else []) + aliases + packs
    cleaned: List[str] = []
    seen_q: set = set()
    for q in packs:
        q = str(q).strip()
        if not q:
            continue
        parts = re.split(r"[/,;|]+", q) if ("/" in q or len(q) > 48) else [q]
        for part in parts:
            part = part.strip()
            if not part or len(part) > 48:
                continue
            key = part.lower()
            if key in seen_q or key == "on":
                continue
            seen_q.add(key)
            cleaned.append(part)
    packs = cleaned

    for q in packs:
        if len(out) >= limit:
            break
        q = str(q).strip()
        if not q:
            continue
        url = f"{BASE}/object/search?{urllib.parse.urlencode({'name': q, 'page': 0, 'size': max(limit, 10)})}"
        try:
            polite_sleep(0.4)
            html = http_get(url, timeout=35.0).decode("utf-8", errors="replace")
        except Exception as exc:
            errors.append(f"tla_search:{q}:{exc}")
            continue

        pairs = _parse_object_results(html)
        if not pairs:
            errors.append(f"tla_search_empty:{q}")
            continue

        for oid, title in pairs:
            if len(out) >= limit:
                break
            if oid in seen:
                continue
            seen.add(oid)
            blob = f"{title} {q}"
            if site and not text_matches_site(blob, site) and q.lower() not in title.lower():
                # Keep if search term is an alias of the site
                continue

            polite_sleep(0.25)
            blurb = _fetch_object_blurb(oid)
            official = "\n".join(
                x
                for x in (
                    title,
                    f"TLA object: {BASE}/object/{oid}",
                    blurb if blurb and blurb != title else "",
                    f"Search query: {q}",
                )
                if x
            )
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": oid,
                    "source_url": f"{BASE}/object/{oid}",
                    "title": title or f"TLA object {oid}",
                    "culture": "egyptian",
                    "official_text": official,
                    "image_url": "",
                    "site": (site or {}).get("id"),
                    "period": "",
                    "license": "Thesaurus Linguae Aegyptiae — see TLA terms of use",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "allow_without_image": True,
                    "meta_extra": {
                        "kind": "literature",
                        "literature_role": "tla_object",
                        "query": q,
                    },
                }
            )
    return out[:limit]
