"""Connector registry — ordered Phase-1 sources."""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from . import (
    archive_org,
    artic,
    digital_giza,
    metmuseum,
    open_context,
    oraec,
    papyri,
    seed_stubs,
    source_scout,
    tla,
    topbib,
    trismegistos,
    web_pdf,
    web_text,
    wikimedia_commons,
)

CONNECTORS: Dict[str, Callable[..., List[Dict[str, Any]]]] = {
    "met": metmuseum.search,
    "commons": wikimedia_commons.search,
    "artic": artic.search,
    "digital_giza": digital_giza.search,
    "archive_org": archive_org.search,
    "web_pdf": web_pdf.search,
    "web_text": web_text.search,
    "topbib": topbib.search,
    "tla": tla.search,
    "oraec": oraec.search,
    "papyri": papyri.search,
    "open_context": open_context.search,
    "trismegistos": trismegistos.search,
    "source_scout": source_scout.search,
    "seed_stub": seed_stubs.search,
}

DEFAULT_ORDER = [
    "met",
    "commons",
    "artic",
    "digital_giza",
    "archive_org",
    "topbib",
    "tla",
    "oraec",
    "papyri",
    "open_context",
    "trismegistos",
]
LITERATURE_CONNECTORS = {
    "archive_org",
    "web_pdf",
    "web_text",
    "topbib",
    "tla",
    "oraec",
    "papyri",
    "trismegistos",
    "open_context",
    "source_scout",
}
OBJECT_CONNECTORS = {"met", "commons", "artic", "digital_giza"}
ALL_LIVE = DEFAULT_ORDER + ["source_scout", "web_pdf"]


def run_connectors(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    sources: Optional[List[str]] = None,
    allow_stubs: bool = False,
) -> Dict[str, Any]:
    order = list(sources or DEFAULT_ORDER)
    if allow_stubs and "seed_stub" not in order:
        order.append("seed_stub")
    if not allow_stubs:
        order = [s for s in order if s != "seed_stub"]

    errors: List[str] = []
    stats: Dict[str, int] = {}
    collected: List[Dict[str, Any]] = []

    lit_names = [s for s in order if s in LITERATURE_CONNECTORS]
    obj_names = [s for s in order if s not in LITERATURE_CONNECTORS]
    # When both object and literature connectors are requested, reserve half the slots
    # so museum images cannot starve TopBib/TLA/Archive.org.
    if lit_names and obj_names:
        lit_budget = max(4, limit // 2)
        obj_budget = max(1, limit - lit_budget)
    elif lit_names:
        lit_budget, obj_budget = limit, 0
    else:
        lit_budget, obj_budget = 0, limit

    def _run_group(names: List[str], budget: int) -> None:
        if budget <= 0 or not names:
            return
        per = max(1, (budget + len(names) - 1) // len(names))
        taken = 0
        for name in names:
            fn = CONNECTORS.get(name)
            if not fn:
                errors.append(f"unknown_connector:{name}")
                continue
            remaining = budget - taken
            if remaining <= 0:
                break
            take = min(per, remaining) if name != "seed_stub" else min(3, remaining)
            if name in LITERATURE_CONNECTORS:
                take = min(max(take, 3), remaining)
            try:
                rows = fn(site=site, limit=take, query=query, errors=errors)
            except Exception as exc:
                errors.append(f"{name}:fatal:{exc}")
                rows = []
            stats[name] = len(rows or [])
            for row in rows or []:
                collected.append(row)
                taken += 1
                if taken >= budget or len(collected) >= limit:
                    break
            if len(collected) >= limit:
                break

    _run_group(obj_names, obj_budget)
    _run_group(lit_names, lit_budget)

    # If nothing live and stubs explicitly allowed, try stubs as last resort
    if not collected and allow_stubs:
        rows = seed_stubs.search(site=site, limit=min(3, limit), query=query, errors=errors)
        stats["seed_stub"] = len(rows)
        collected.extend(rows)

    return {
        "items": collected[:limit],
        "errors": errors,
        "connector_stats": stats,
    }
