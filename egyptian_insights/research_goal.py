"""Canonical Egyptian Insights research goal (early-period three sites)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

_GOAL_PATH = Path(__file__).resolve().parent / "research_goal.json"
_CACHE: Optional[Dict[str, Any]] = None


def load_goal() -> Dict[str, Any]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    try:
        _CACHE = json.loads(_GOAL_PATH.read_text(encoding="utf-8"))
    except Exception:
        _CACHE = {
            "id": "early-period-three-sites",
            "title": "Earliest Egyptian writing — Abydos, Heliopolis, Giza",
            "summary": "Collate earliest-period primary sources for Abydos/Oserion, Heliopolis, and Giza.",
            "sites": [],
            "agent_mandate": "Harvest into cultures_cache; structure by site.",
            "default_harvest_limit": 15,
        }
    return _CACHE


def site_ids() -> List[str]:
    return [str(s.get("id")) for s in (load_goal().get("sites") or []) if s.get("id")]


def resolve_site(focus: Optional[str]) -> Optional[Dict[str, Any]]:
    if not focus:
        return None
    key = str(focus).strip().lower()
    for site in load_goal().get("sites") or []:
        aliases = [str(site.get("id") or "").lower()] + [
            str(a).lower() for a in (site.get("aliases") or [])
        ]
        if key in aliases or any(a and a in key for a in aliases):
            return site
    return None


def default_query(focus: Optional[str] = None) -> str:
    site = resolve_site(focus)
    if site and site.get("query"):
        return str(site["query"])
    sites = load_goal().get("sites") or []
    if sites and sites[0].get("query"):
        return str(sites[0]["query"])
    return "Egyptian Early Dynastic hieroglyph Abydos"


def mandate_text() -> str:
    g = load_goal()
    parts = [
        g.get("title") or "",
        g.get("summary") or "",
        g.get("agent_mandate") or "",
    ]
    return "\n\n".join(p for p in parts if p).strip()


def brief_for_site(site_id: str) -> str:
    site = resolve_site(site_id) or {}
    label = site.get("label") or site_id
    query = site.get("query") or default_query(site_id)
    priorities = site.get("priorities") or []
    pri = "; ".join(str(p) for p in priorities[:4])
    return (
        f"Harvest open digital primary sources for {label} into cultures_cache. "
        f"Focus: earliest periods (Predynastic → Early Dynastic → Old Kingdom). "
        f"Query hint: {query}. "
        f"Priorities: {pri}. "
        f"Prefer images + official catalogue text; tag meta.site={site.get('id') or site_id}."
    )
