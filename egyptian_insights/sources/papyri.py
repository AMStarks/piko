"""Papyri / Integrating Digital Papyrology connector.

papyri.info's HTML front-door is Anubis-gated, so discovery uses the open
GitHub dump `papyri/idp.data` (same corpus the Navigator serves). When
PIKO_EI_PAPYRI_IDP_DIR points at a local clone, we prefer filesystem search.

We do not vendor papyri/navigator — that repo is the search UI; idp.data is
the ingestible corpus.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree as ET

from . import github_code
from .base import query_pack_for_site, text_matches_site

CONNECTOR_ID = "papyri"
REPO = "papyri/idp.data"
PAPYRI_INFO = "https://papyri.info"

# Content search on GitHub requires a token; these curated dump paths keep
# Abydos/Giza/etc. reachable without auth (verified present in idp.data).
CURATED_PATHS = {
    "abydos": [
        "DCLP/98/98058.xml",
        "DCLP/97/97713.xml",
        "DCLP/108/108412.xml",
        "Biblio/80/79842.xml",
        "Biblio/79/78616.xml",
    ],
    "osireion": [
        "Biblio/80/79842.xml",
    ],
    "giza": [
        "Biblio/61/60862.xml",
    ],
    "egypt": [
        "DCLP/98/98058.xml",
        "Biblio/80/79842.xml",
    ],
}


def _local_root() -> str:
    return str(os.environ.get("PIKO_EI_PAPYRI_IDP_DIR") or "").strip()


def _walk_local(query: str, limit: int) -> List[Dict[str, str]]:
    root = _local_root()
    if not root or not os.path.isdir(root):
        return []
    q = query.lower()
    hits: List[Dict[str, str]] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not (name.endswith(".xml") or name.endswith(".if")):
                continue
            path = os.path.join(dirpath, name)
            try:
                # cheap prefilter by filename then small read
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    chunk = fh.read(12000)
            except Exception:
                continue
            if q not in chunk.lower() and q not in name.lower():
                continue
            rel = os.path.relpath(path, root).replace(os.sep, "/")
            hits.append({"path": rel, "snippet": chunk[:400]})
            if len(hits) >= limit:
                return hits
    return hits


def _xml_title_and_text(raw: str, path: str) -> Dict[str, str]:
    title = path
    place = ""
    body_bits: List[str] = []
    try:
        root = ET.fromstring(raw)
        for el in root.iter():
            tag = el.tag.split("}")[-1] if isinstance(el.tag, str) else ""
            text = (el.text or "").strip()
            if not text:
                continue
            if tag in ("title", "mainTitle") and len(text) > 3:
                title = text[:240]
            elif tag in ("origPlace", "placeName") and len(text) > 2:
                place = text[:160]
            elif tag in ("ab", "p", "l", "note") and 12 <= len(text) <= 500:
                body_bits.append(text)
                if len(body_bits) >= 8:
                    break
    except Exception:
        body_bits = [raw[:800]]
    return {
        "title": title,
        "place": place,
        "body": "\n".join(body_bits[:8]),
    }


def _info_url_for_path(path: str) -> str:
    """Best-effort canonical papyri.info URL from dump path."""
    p = path.replace("\\", "/")
    lower = p.lower()
    if "ddbdp/" in lower or lower.startswith("ddbdp/"):
        # DDbDP/series/file.xml — Navigator uses series;volume;item form; keep dump link + search
        return f"{PAPYRI_INFO}/browse/ddbdp/"
    if "dclp/" in lower:
        return f"{PAPYRI_INFO}/browse/dclp/"
    if "apis/" in lower:
        return f"{PAPYRI_INFO}/browse/apis/"
    if "hgv" in lower:
        return f"{PAPYRI_INFO}/browse/hgv/"
    return f"{PAPYRI_INFO}/search"


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

    file_hits: List[Dict[str, str]] = []
    for q in packs:
        if len(file_hits) >= limit:
            break
        local = _walk_local(q, limit=limit)
        for h in local:
            if h["path"] in seen:
                continue
            seen.add(h["path"])
            file_hits.append(h)
        if local:
            continue
        items = github_code.code_search(q, repo=REPO, limit=min(limit, 10), errors=errors)
        for it in items:
            path = str(it.get("path") or "")
            if not path or path in seen:
                continue
            if not (path.endswith(".xml") or path.endswith(".if")):
                continue
            seen.add(path)
            file_hits.append({"path": path, "snippet": ""})
        # Unauthenticated fallback: curated dump paths for known sites
        key = q.lower().replace(" ", "_")
        for path in CURATED_PATHS.get(key, []):
            if path in seen:
                continue
            seen.add(path)
            file_hits.append({"path": path, "snippet": ""})
    if not file_hits:
        for path in CURATED_PATHS.get("egypt", []):
            if path in seen:
                continue
            seen.add(path)
            file_hits.append({"path": path, "snippet": ""})

    for hit in file_hits:
        if len(out) >= limit:
            break
        path = hit["path"]
        raw = ""
        local_root = _local_root()
        if local_root:
            abs_path = os.path.join(local_root, path)
            if os.path.isfile(abs_path):
                try:
                    with open(abs_path, "r", encoding="utf-8", errors="replace") as fh:
                        raw = fh.read(60000)
                except Exception as exc:
                    errors.append(f"papyri_local_read:{exc}")
        if not raw:
            try:
                raw = github_code.fetch_raw(REPO, path, refs=["master", "main"], timeout=60.0)
            except Exception as exc:
                errors.append(f"papyri_fetch:{path}:{exc}")
                # still emit a pointer from search hit
                raw = hit.get("snippet") or path

        meta = _xml_title_and_text(raw, path)
        blob = f"{meta['title']} {meta['place']} {meta['body']} {path}"
        if site and not text_matches_site(blob, site):
            # keep if any query term appears
            if not any(q.lower() in blob.lower() for q in packs):
                continue

        gh_url = f"https://github.com/{REPO}/blob/master/{path}"
        info_url = _info_url_for_path(path)
        official = "\n".join(
            x
            for x in (
                meta["title"],
                f"idp.data path: {path}",
                f"Place: {meta['place']}" if meta["place"] else "",
                meta["body"],
                f"GitHub: {gh_url}",
                f"Papyri.info browse: {info_url}",
                "Corpus: Integrating Digital Papyrology (DDbDP/HGV/APIS/DCLP).",
            )
            if x
        )
        out.append(
            {
                "source": CONNECTOR_ID,
                "source_id": path.replace("/", "_")[:120],
                "source_url": gh_url,
                "title": (meta["title"] or path)[:240],
                "culture": "egyptian",
                "official_text": official[:8000],
                "image_url": "",
                "site": meta["place"] or (site or {}).get("id") or "",
                "period": "",
                "license": "Integrating Digital Papyrology / papyri.info — see project terms (CC-BY for many texts)",
                "connector": CONNECTOR_ID,
                "is_stub": False,
                "allow_without_image": True,
                "meta_extra": {
                    "kind": "literature",
                    "literature_role": "papyri_idp",
                    "idp_path": path,
                    "provider": "papyri/idp.data",
                    "navigator": "papyri/navigator (UI only; not vendored)",
                },
            }
        )
    return out[:limit]
