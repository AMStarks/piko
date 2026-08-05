"""Internet Archive literature connector (metadata + OCR text + PDF)."""
from __future__ import annotations

import urllib.parse
from typing import Any, Dict, List, Optional

from .base import download_document, http_get_json, literature_matches_site, polite_sleep, query_pack_for_site

CONNECTOR_ID = "archive_org"
META = "https://archive.org/metadata"
SEARCH = "https://archive.org/advancedsearch.php"
DOWNLOAD = "https://archive.org/download"

# Seed volumes with confirmed OCR/PDF on archive.org (verified 2026-07).
# Prefer Petrie / Vyse primary excavation reports over thin catalogue stubs.
SITE_SEEDS: Dict[str, List[str]] = {
    "abydos": [
        "abydos1petr",
        "abydos00petr",
    ],
    "heliopolis": [
        "heliopolis-kafr-ammar-and-shurafa",
        "heliopoliskafram0000wmfl",
    ],
    "giza": [
        "cu31924012038927",  # Petrie, The pyramids and temples of Gizeh (1883)
        "gizeh-and-rifeh",
        "gizehrifeh0000wmfl",
        "operationscarrie01howa",  # Vyse, Operations at the pyramids of Gizeh
    ],
}


def _pick_file(files: List[Dict[str, Any]], *predicates) -> Optional[Dict[str, Any]]:
    for pred in predicates:
        for f in files:
            name = str(f.get("name") or "")
            fmt = str(f.get("format") or "")
            if pred(name, fmt, f):
                return f
    return None


def _ocr_and_pdf(identifier: str, files: List[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    ocr = _pick_file(
        files,
        lambda n, fmt, _f: n.endswith("_djvu.txt") or fmt == "DjVuTXT",
        lambda n, fmt, _f: fmt in ("Full Text", "Text") and n.endswith(".txt"),
    )
    pdf = _pick_file(
        files,
        lambda n, fmt, _f: fmt in ("Text PDF", "PDF") and n.endswith(".pdf"),
        lambda n, fmt, _f: n.endswith(".pdf") and "pdf" in fmt.lower(),
    )
    ocr_url = f"{DOWNLOAD}/{identifier}/{ocr['name']}" if ocr else None
    pdf_url = f"{DOWNLOAD}/{identifier}/{pdf['name']}" if pdf else None
    return {"ocr_url": ocr_url, "pdf_url": pdf_url, "ocr_name": (ocr or {}).get("name"), "pdf_name": (pdf or {}).get("name")}


def _chunk_text(text: str, *, max_chunks: int = 24, chunk_size: int = 3500) -> List[str]:
    text = (text or "").strip()
    if not text:
        return []
    chunks: List[str] = []
    i = 0
    while i < len(text) and len(chunks) < max_chunks:
        end = min(len(text), i + chunk_size)
        # Prefer break on paragraph/page markers
        window = text[i:end]
        for sep in ("\n\n", "\f", "\n"):
            pos = window.rfind(sep)
            if pos > chunk_size // 3:
                end = i + pos + len(sep)
                break
        chunk = text[i:end].strip()
        if chunk:
            chunks.append(chunk)
        i = max(end, i + 1)
    return chunks


def _ingest_identifier(
    identifier: str,
    *,
    site: Optional[Dict[str, Any]],
    errors: List[str],
    include_chunks: bool = True,
) -> List[Dict[str, Any]]:
    try:
        data = http_get_json(f"{META}/{urllib.parse.quote(identifier)}", timeout=40.0)
    except Exception as exc:
        errors.append(f"archive_org_meta:{identifier}:{exc}")
        return []

    md = data.get("metadata") or {}
    files = list(data.get("files") or [])
    title = str(md.get("title") or identifier)
    creator = md.get("creator")
    if isinstance(creator, list):
        creator = "; ".join(str(c) for c in creator)
    year = md.get("year") or md.get("date") or ""
    description = str(md.get("description") or "")
    blob = f"{title} {creator} {description} {identifier}"
    if site and not literature_matches_site(blob, site) and identifier not in SITE_SEEDS.get(str(site.get("id") or ""), []):
        # Allow curated seeds even if alias match is weak
        all_seeds = {s for vals in SITE_SEEDS.values() for s in vals}
        if identifier not in all_seeds:
            return []

    assets = _ocr_and_pdf(identifier, files)
    ocr_text = ""
    if assets.get("ocr_url"):
        polite_sleep(0.4)
        raw = download_document(str(assets["ocr_url"]), timeout=120.0, referer=f"https://archive.org/details/{identifier}")
        if raw:
            ocr_text = raw.decode("utf-8", errors="replace")
        else:
            errors.append(f"archive_org_ocr_download_failed:{identifier}")

    header = "\n".join(
        x
        for x in (
            title,
            f"Creator: {creator}" if creator else "",
            f"Year: {year}" if year else "",
            f"Internet Archive: https://archive.org/details/{identifier}",
            description[:1200] if description else "",
        )
        if x
    )
    work_text = header
    if ocr_text:
        # Cap work-level body; full OCR lives in chunks when present
        body = ocr_text if len(ocr_text) <= 80_000 else (ocr_text[:80_000] + "\n\n[… OCR truncated; see chunk records …]")
        work_text = f"{header}\n\n--- OCR ---\n\n{body}"
    elif len(header) < 400 and not assets.get("pdf_url"):
        # No OCR and no PDF — do not pretend this is digitized literature
        errors.append(f"archive_org_thin_no_ocr:{identifier}")
        return []

    site_id = (site or {}).get("id")
    out: List[Dict[str, Any]] = [
        {
            "source": CONNECTOR_ID,
            "source_id": identifier,
            "source_url": f"https://archive.org/details/{identifier}",
            "title": title,
            "culture": "egyptian",
            "official_text": work_text,
            "image_url": "",
            "document_url": assets.get("pdf_url") or "",
            "document_ext": ".pdf" if assets.get("pdf_url") else "",
            "site": site_id,
            "period": str(year or ""),
            "license": "Internet Archive item terms — prefer public-domain / open volumes",
            "connector": CONNECTOR_ID,
            "is_stub": False,
            "allow_without_image": True,
            "meta_extra": {
                "kind": "literature",
                "literature_role": "work",
                "creator": creator,
                "year": year,
                "ocr_url": assets.get("ocr_url"),
                "pdf_url": assets.get("pdf_url"),
                "ocr_chars": len(ocr_text),
            },
        }
    ]

    if include_chunks and ocr_text:
        for i, chunk in enumerate(_chunk_text(ocr_text), start=1):
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": f"{identifier}:chunk:{i}",
                    "source_url": f"https://archive.org/details/{identifier}",
                    "title": f"{title} — section {i}",
                    "culture": "egyptian",
                    "official_text": chunk,
                    "image_url": "",
                    "site": site_id,
                    "period": str(year or ""),
                    "license": "Internet Archive item terms — prefer public-domain / open volumes",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "allow_without_image": True,
                    "meta_extra": {
                        "kind": "literature",
                        "literature_role": "chunk",
                        "parent_id": identifier,
                        "chunk_index": i,
                        "creator": creator,
                        "year": year,
                    },
                }
            )
    return out


def _search_identifiers(query: str, *, rows: int = 8, site: Optional[Dict[str, Any]] = None) -> List[str]:
    q = f"({query}) AND mediatype:texts"
    params = (
        f"q={urllib.parse.quote(q)}"
        f"&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year"
        f"&rows={rows}&page=1&output=json"
    )
    data = http_get_json(f"{SEARCH}?{params}", timeout=40.0)
    docs = ((data.get("response") or {}).get("docs")) or []
    ids: List[str] = []
    for d in docs:
        ident = str(d.get("identifier") or "")
        if not ident:
            continue
        title = str(d.get("title") or "")
        creator = d.get("creator")
        if isinstance(creator, list):
            creator = "; ".join(str(c) for c in creator)
        blob = f"{title} {creator} {ident}"
        if site and not literature_matches_site(blob, site):
            continue
        ids.append(ident)
    return ids


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
    site_id = (site or {}).get("id")
    identifiers: List[str] = []
    qlow = str(query or "").lower()
    want_petrie = "petrie" in qlow or "flinders" in qlow

    # Prefer curated seeds for focus sites (Petrie Abydos etc.)
    for sid in SITE_SEEDS.get(str(site_id or ""), []):
        if sid not in identifiers:
            identifiers.append(sid)

    # Unscoped Petrie / author asks: pull curated seeds from all three sites
    if not site_id and want_petrie:
        for sid_list in SITE_SEEDS.values():
            for sid in sid_list:
                if sid not in identifiers:
                    identifiers.append(sid)

    packs = query_pack_for_site(site, query or "Egyptian archaeology")
    for q in packs[:3]:
        if len(identifiers) >= max(limit, 6):
            break
        try:
            polite_sleep(0.35)
            found = _search_identifiers(q, rows=8, site=site)
            for ident in found:
                if ident not in identifiers:
                    identifiers.append(ident)
        except Exception as exc:
            errors.append(f"archive_org_search:{q}:{exc}")

    # Cap identifiers before expand (chunks multiply rows)
    max_works = max(1, min(6 if want_petrie else 4, limit))
    for ident in identifiers[:max_works]:
        if ident in seen:
            continue
        seen.add(ident)
        remaining = limit - len(out)
        if remaining <= 0:
            break
        rows = _ingest_identifier(ident, site=site, errors=errors, include_chunks=True)
        for row in rows:
            if len(out) >= limit:
                break
            if want_petrie:
                all_seeds = {s for vals in SITE_SEEDS.values() for s in vals}
                parent = str(row.get("source_id") or "").split(":chunk:")[0]
                blob = f"{row.get('title') or ''} {(row.get('meta_extra') or {}).get('creator') or ''} {row.get('official_text') or ''} {parent}".lower()
                if parent not in all_seeds and "petrie" not in blob and "flinders" not in blob:
                    errors.append(f"archive_org_skip_non_petrie:{row.get('source_id')}")
                    continue
            out.append(row)
        polite_sleep(0.35)
    return out[:limit]
