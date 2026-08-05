"""Trismegistos Demotic text index connector.

Uses the open dataset published with christiancasey/trismegistos
(`Text Data.csv`) rather than live HTML scraping of trismegistos.org
(SSL/ToS fragile). Each hit points at the canonical TM text page.

Optional: set PIKO_EI_TM_CSV to a local CSV path.
"""
from __future__ import annotations

import csv
import io
import os
import time
from typing import Any, Dict, List, Optional

from . import github_code
from .base import query_pack_for_site, text_matches_site

CONNECTOR_ID = "trismegistos"
REPO = "christiancasey/trismegistos"
CSV_PATH = "Text Data.csv"
TM_TEXT = "https://www.trismegistos.org/text/"
CACHE_TTL_S = 14 * 24 * 3600


def _cache_path() -> str:
    root = (
        str(os.environ.get("EGYPTIAN_INSIGHTS_DATA_DIR") or "").strip()
        or str(os.environ.get("PIKO_EGYPTIAN_DATA_DIR") or "").strip()
        or os.path.join(str(os.environ.get("PIKO_DATA_DIR") or "").strip() or "/tmp", "egyptian-insights")
    )
    return os.path.join(root, "cache", "trismegistos_text_data.csv")


def _load_csv(errors: List[str]) -> List[Dict[str, str]]:
    override = str(os.environ.get("PIKO_EI_TM_CSV") or "").strip()
    path = override or _cache_path()
    text = ""
    try:
        if os.path.exists(path) and (override or (time.time() - os.path.getmtime(path)) < CACHE_TTL_S):
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
    except Exception as exc:
        errors.append(f"tm_cache_read:{exc}")

    if not text:
        try:
            text = github_code.fetch_raw(REPO, CSV_PATH, refs=["master", "main"], timeout=90.0)
            if not override:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
        except Exception as exc:
            errors.append(f"tm_csv_fetch:{exc}")
            return []

    # Skip leading empty column name from the published CSV (",TM Number,...")
    reader = csv.DictReader(io.StringIO(text))
    rows: List[Dict[str, str]] = []
    for row in reader:
        if not isinstance(row, dict):
            continue
        # normalize keys
        cleaned = {str(k or "").strip(): str(v or "").strip() for k, v in row.items()}
        rows.append(cleaned)
    return rows


def _tm_number(row: Dict[str, str]) -> str:
    for key in ("TM Number", "TMNumber", "tm", "TM"):
        if row.get(key):
            return row[key]
    # sometimes first non-empty numeric-ish field
    for v in row.values():
        if v.isdigit():
            return v
    return ""


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
    if not packs:
        packs = ["Egypt"]

    rows = _load_csv(errors)
    if not rows:
        return []

    for q in packs:
        if len(out) >= limit:
            break
        ql = q.lower()
        for row in rows:
            if len(out) >= limit:
                break
            prov = row.get("Provenance") or row.get("provenance") or ""
            lang = row.get("Language") or row.get("language") or ""
            period = row.get("Period") or row.get("period") or ""
            date_s = row.get("Date String") or row.get("Date") or ""
            blob = f"{prov} {lang} {period} {date_s}"
            matched = ql in blob.lower()
            if not matched and site and text_matches_site(blob, site):
                matched = True
            if not matched:
                continue
            tm = _tm_number(row)
            if not tm or tm in seen:
                continue
            # Casey dump is Demotic-focused; skip empty language noise
            if lang and "demotic" not in lang.lower() and "egyptian" not in lang.lower():
                if ql not in prov.lower():
                    continue
            seen.add(tm)
            url = f"{TM_TEXT}{tm}"
            title = f"Trismegistos text {tm}"
            if prov:
                title = f"TM {tm} — {prov}"
            official = "\n".join(
                x
                for x in (
                    title,
                    f"Language: {lang}" if lang else "",
                    f"Period: {period}" if period else "",
                    f"Date: {date_s}" if date_s else "",
                    f"Provenance: {prov}" if prov else "",
                    f"Trismegistos: {url}",
                    "Index source: christiancasey/trismegistos Text Data.csv (Demotic-focused dump).",
                )
                if x
            )
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": tm,
                    "source_url": url,
                    "title": title[:240],
                    "culture": "egyptian",
                    "official_text": official[:4000],
                    "image_url": "",
                    "site": prov or (site or {}).get("id") or "",
                    "period": period or date_s,
                    "license": "Trismegistos — see https://www.trismegistos.org/about.php",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "allow_without_image": True,
                    "meta_extra": {
                        "kind": "literature",
                        "literature_role": "trismegistos_index",
                        "language": lang,
                        "provider": "christiancasey/trismegistos + trismegistos.org",
                    },
                }
            )
    return out[:limit]
