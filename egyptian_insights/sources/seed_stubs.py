"""Offline seed stubs — only when allow_stubs=true."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

CONNECTOR_ID = "seed_stub"

_STUBS: List[Dict[str, Any]] = [
    {
        "source": CONNECTOR_ID,
        "source_id": "narmer-palette-recto",
        "source_url": "https://commons.wikimedia.org/wiki/File:Narmer_Palette.jpg",
        "title": "Narmer Palette (seed stub)",
        "culture": "egyptian",
        "site": "abydos",
        "period": "Early Dynastic",
        "official_text": "Seed stub only — not a live harvest.",
        "image_url": "",
        "local_sample": "smoke_glyph.png",
        "license": "stub",
        "connector": CONNECTOR_ID,
        "is_stub": True,
    },
]


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 3,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    _ = query
    errors = errors if errors is not None else []
    site_id = (site or {}).get("id")
    rows = [r for r in _STUBS if not site_id or r.get("site") == site_id]
    if not rows:
        rows = list(_STUBS)
    errors.append("seed_stubs_used")
    return rows[: max(1, min(limit, 3))]
