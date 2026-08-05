"""ORAEC corpus connector — open Egyptian text corpus (GitHub raw dumps).

Primary index: oraec_hierarchical_path.tsv (place/title paths).
Full records: oraecN.json (sentences, translations, bibliography).
Also searches oraec/scraped_data via GitHub code search when useful.

License: cc-by-sa-4.0 (see ORAEC README). Prefer primary inscription texts.
"""
from __future__ import annotations

import html
import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from . import github_code
from .base import polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "oraec"
REPO = "oraec/corpus_raw_data"
SCRAPED_REPO = "oraec/scraped_data"
PATH_TSV = "oraec_hierarchical_path.tsv"
CACHE_TTL_S = 7 * 24 * 3600


def _cache_path() -> str:
    root = (
        str(os.environ.get("EGYPTIAN_INSIGHTS_DATA_DIR") or "").strip()
        or str(os.environ.get("PIKO_EGYPTIAN_DATA_DIR") or "").strip()
        or os.path.join(str(os.environ.get("PIKO_DATA_DIR") or "").strip() or "/tmp", "egyptian-insights")
    )
    return os.path.join(root, "cache", "oraec_hierarchical_path.tsv")


def _load_path_index(errors: List[str]) -> List[Tuple[str, str]]:
    """Return list of (oraec_id, plain_path)."""
    path = _cache_path()
    text = ""
    try:
        if os.path.exists(path) and (time.time() - os.path.getmtime(path)) < CACHE_TTL_S:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
    except Exception as exc:
        errors.append(f"oraec_cache_read:{exc}")

    if not text:
        try:
            text = github_code.fetch_raw(REPO, PATH_TSV, refs=["main", "master"], timeout=90.0)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
        except Exception as exc:
            errors.append(f"oraec_path_fetch:{exc}")
            return []

    rows: List[Tuple[str, str]] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        # TSV: id \t plain_path \t html_path
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        oid = parts[0].strip()
        plain = parts[1].strip()
        if oid.startswith("oraec"):
            rows.append((oid, plain))
    return rows


def _match_ids(index: List[Tuple[str, str]], query: str, limit: int) -> List[Tuple[str, str]]:
    q = (query or "").strip().lower()
    if not q:
        return []
    hits: List[Tuple[str, str]] = []
    for oid, plain in index:
        if q in plain.lower():
            hits.append((oid, plain))
            if len(hits) >= limit:
                break
    return hits


def _strip_tags(html: str) -> str:
    out = []
    in_tag = False
    for ch in html or "":
        if ch == "<":
            in_tag = True
            continue
        if ch == ">":
            in_tag = False
            continue
        if not in_tag:
            out.append(ch)
    return "".join(out).strip()


def _record_from_json(oid: str, raw: str, path_hint: str = "") -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(raw)
    except Exception:
        return None
    rec = data.get(oid) if isinstance(data, dict) else None
    if not isinstance(rec, dict):
        # sometimes the file is the record itself
        if isinstance(data, dict) and data.get("oraecid"):
            rec = data
        else:
            return None

    title = html.unescape(str(rec.get("title") or oid))
    places = []
    for p in rec.get("origplace") or []:
        if isinstance(p, dict) and p.get("origplace"):
            places.append(str(p["origplace"]))
        elif isinstance(p, str):
            places.append(p)
    dates = []
    for d in rec.get("date") or []:
        if isinstance(d, dict) and d.get("date"):
            dates.append(str(d["date"]))
    bib = str(rec.get("bibliography") or "").strip()
    translations = []
    for sent in rec.get("sentences") or []:
        if isinstance(sent, dict) and sent.get("translation"):
            translations.append(str(sent["translation"]).strip())
        if len(translations) >= 8:
            break

    credits = rec.get("credits") if isinstance(rec.get("credits"), dict) else {}
    license_s = str(credits.get("license") or "cc-by-sa-4.0")
    source_url = f"https://github.com/{REPO}/blob/main/{oid}.json"
    official = "\n".join(
        x
        for x in (
            title,
            f"ORAEC id: {oid}",
            f"Place: {', '.join(places)}" if places else "",
            f"Date: {', '.join(dates)}" if dates else "",
            f"Path: {path_hint}" if path_hint else "",
            "Translations:",
            *translations[:6],
            f"Bibliography:\n{bib[:1200]}" if bib else "",
            f"Source: {source_url}",
        )
        if x
    )
    return {
        "source": CONNECTOR_ID,
        "source_id": oid,
        "source_url": source_url,
        "title": title[:240],
        "culture": "egyptian",
        "official_text": official[:8000],
        "image_url": "",
        "site": places[0] if places else "",
        "period": dates[0] if dates else "",
        "license": f"ORAEC {license_s}",
        "connector": CONNECTOR_ID,
        "is_stub": False,
        "allow_without_image": True,
        "meta_extra": {
            "kind": "literature",
            "literature_role": "oraec_text",
            "places": places,
            "provider": "oraec/corpus_raw_data",
        },
    }


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

    index = _load_path_index(errors)
    candidates: List[Tuple[str, str]] = []
    for q in packs:
        if len(candidates) >= limit * 2:
            break
        for oid, plain in _match_ids(index, q, limit=limit):
            if oid in seen:
                continue
            # site filter soft: prefer matches; path already query-matched
            if site and not text_matches_site(plain, site) and q.lower() not in plain.lower():
                continue
            seen.add(oid)
            candidates.append((oid, plain))

    # Fallback: GitHub code search if index miss
    if not candidates:
        for q in packs[:3]:
            items = github_code.code_search(q, repo=REPO, limit=min(limit, 8), errors=errors)
            for it in items:
                path = str(it.get("path") or "")
                if not path.endswith(".json") or not path.startswith("oraec"):
                    continue
                oid = path.split("/")[-1].replace(".json", "")
                if oid in seen:
                    continue
                seen.add(oid)
                candidates.append((oid, path))

    for oid, hint in candidates:
        if len(out) >= limit:
            break
        try:
            raw = github_code.fetch_raw(REPO, f"{oid}.json", refs=["main", "master"])
        except Exception as exc:
            errors.append(f"oraec_fetch:{oid}:{exc}")
            continue
        row = _record_from_json(oid, raw, path_hint=_strip_tags(hint))
        if row:
            out.append(row)
    return out[:limit]
