"""Shared HTTP helpers for EI source connectors."""
from __future__ import annotations

import json
import time
import urllib.request
from typing import Any, Dict, List, Optional

USER_AGENT = "PikoEgyptianInsights/1.0 (personal research; respectful crawler)"
MIN_IMAGE_BYTES = 10_000


def http_get(url: str, timeout: float = 30.0, accept: str = "*/*", referer: str = "") -> bytes:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
    }
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_json(url: str, timeout: float = 30.0) -> Dict[str, Any]:
    raw = http_get(url, timeout=timeout, accept="application/json")
    return json.loads(raw.decode("utf-8"))


def polite_sleep(seconds: float = 0.35) -> None:
    time.sleep(max(0.0, float(seconds)))


def download_bytes(url: str, timeout: float = 60.0, referer: str = "") -> Optional[bytes]:
    if not url:
        return None
    # Prefer image accept + optional referer (ARTIC/CDN often 403 without)
    for ref in (referer, "https://www.artic.edu/", "https://commons.wikimedia.org/", ""):
        try:
            data = http_get(
                url,
                timeout=timeout,
                accept="image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                referer=ref,
            )
            if data:
                return data
        except Exception:
            continue
    return None


def download_document(url: str, timeout: float = 180.0, referer: str = "") -> Optional[bytes]:
    """Download PDF/text assets (longer timeout than images)."""
    if not url:
        return None
    try:
        return http_get(url, timeout=timeout, accept="*/*", referer=referer)
    except Exception:
        return None


def query_pack_for_site(site: Optional[Dict[str, Any]], fallback_query: str = "") -> List[str]:
    if site:
        pack = site.get("query_pack") or []
        if pack:
            return [str(q) for q in pack if str(q).strip()]
        if site.get("query"):
            return [str(site["query"])]
    if fallback_query:
        return [fallback_query]
    return ["Egyptian hieroglyph"]


def text_matches_site(text: str, site: Optional[Dict[str, Any]]) -> bool:
    if not site:
        return True
    blob = (text or "").lower()
    aliases = [str(site.get("id") or "").lower()] + [
        str(a).lower() for a in (site.get("aliases") or []) if a and str(a).lower() not in ("on",)
    ]
    return any(a and a in blob for a in aliases)


# Irrelevant / non-goal hits often returned by broad pyramid / Egypt queries.
# Note: Magicians of the Gods (Hancock) is intentionally allowed — operator wants it in corpus.
_BLOCKED_LITERATURE = (
    "chariots of the gods",
    "von daniken",
    "von däniken",
    "ancient aliens",
    "cia reading room",
    "central intelligence agency",
    "nibiru",
    "atlantis conspiracy",
)


_SITE_LITERATURE_HINTS: Dict[str, List[str]] = {
    "abydos": [
        "abydos", "umm el-qa", "umm el qa", "osireion", "oserion", "petrie", "early dynastic",
        "hieroglyph", "pharaoh", "egypt", "dynasty",
    ],
    "heliopolis": [
        "heliopolis", "iunu", "innu", "on egypt", "obelisk", "re-horakhty", "ra ", "egypt",
        "hieroglyph", "old kingdom", "pharaoh",
    ],
    "giza": [
        "giza", "gizeh", "khufu", "khafre", "menkaure", "cheops", "sphinx", "mastaba",
        "pyramid", "hieroglyph", "old kingdom", "egypt", "dynasty", "petrie",
    ],
}


def is_blocked_literature(text: str) -> bool:
    blob = (text or "").lower()
    return any(term in blob for term in _BLOCKED_LITERATURE)


def literature_matches_site(text: str, site: Optional[Dict[str, Any]]) -> bool:
    """Stricter than text_matches_site — rejects modern pseudohistory and weak alias-only hits."""
    if not site:
        return True
    blob = (text or "").lower()
    if is_blocked_literature(blob):
        return False
    site_id = str(site.get("id") or "").lower()
    hints = _SITE_LITERATURE_HINTS.get(site_id, [])
    if not hints:
        return text_matches_site(blob, site)
    hits = sum(1 for h in hints if h in blob)
    # Require site name/alias OR two contextual Egyptology signals
    aliases = [site_id] + [str(a).lower() for a in (site.get("aliases") or []) if a]
    has_alias = any(a and len(a) > 2 and a in blob for a in aliases if a not in ("on",))
    if has_alias and hits >= 1:
        return True
    return hits >= 2
