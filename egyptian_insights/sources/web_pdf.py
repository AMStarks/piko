"""Open-web PDF seeker — SearXNG (and optional Serper) → confirm PDF → harvest rows.

Search is unrestricted across the web. Ingest is quality-gated (confirmed PDFs only);
non-downloadable hits are stored as source_candidate gaps with the URL.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from .base import USER_AGENT, download_document, polite_sleep

CONNECTOR_ID = "web_pdf"
MAX_PDF_BYTES = int(os.environ.get("PIKO_EI_WEB_PDF_MAX_BYTES") or 80_000_000)
PROBE_TIMEOUT = float(os.environ.get("PIKO_EI_WEB_PDF_PROBE_TIMEOUT") or 20.0)
SEARCH_TIMEOUT = float(os.environ.get("PIKO_EI_WEB_PDF_SEARCH_TIMEOUT") or 25.0)

# Summary-mill / stub hosts — never ingest as the actual work.
SUMMARY_MILL_HOSTS = {
    "bookey.app",
    "cdn.bookey.app",
    "blinkist.com",
    "sparknotes.com",
    "cliffsnotes.com",
    "shortform.com",
    "litcharts.com",
    "gradesaver.com",
    "getabstract.com",
    "instaread.co",
    "12min.com",
    "quickread.com",
}


def _host_denied(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower().lstrip("www.")
    except Exception:
        return False
    for bad in SUMMARY_MILL_HOSTS:
        if host == bad or host.endswith("." + bad):
            return True
    return False


def _extract_seed_urls(query: str) -> Tuple[str, List[str], List[str]]:
    """Parse SEED_URL: / ALT_QUERY: lines and bare URL-only queries."""
    raw = str(query or "").strip()
    seeds: List[str] = []
    alts: List[str] = []
    primary_lines: List[str] = []
    for line in raw.splitlines():
        t = line.strip()
        if not t:
            continue
        if t.upper().startswith("SEED_URL:"):
            u = t.split(":", 1)[1].strip()
            if u.startswith("http"):
                seeds.append(u)
            continue
        if t.upper().startswith("ALT_QUERY:"):
            q = t.split(":", 1)[1].strip()
            if q:
                alts.append(q)
            continue
        primary_lines.append(t)
    primary = " ".join(primary_lines).strip()
    # Only fall back to the raw first line when nothing was consumed as a
    # SEED_URL/ALT_QUERY — otherwise "SEED_URL:<url>" resurrects as a keyword query.
    if not primary and raw and not seeds and not alts:
        primary = raw.splitlines()[0].strip()
    # Whole query is a single URL
    if re.match(r"^https?://\S+$", primary.strip(), re.I):
        seeds.insert(0, primary.strip())
        primary = ""
    # Dedupe
    seen = set()
    uniq_seeds: List[str] = []
    for u in seeds:
        if u not in seen:
            seen.add(u)
            uniq_seeds.append(u)
    return primary, uniq_seeds, alts


def _searxng_base() -> str:
    return str(os.environ.get("SEARXNG_URL") or "http://127.0.0.1:8080").rstrip("/")


def _serper_key() -> str:
    return str(os.environ.get("SERPER_API_KEY") or os.environ.get("SERPER_KEY") or "").strip()


def _http_json(url: str, *, method: str = "GET", body: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None, timeout: float = SEARCH_TIMEOUT) -> Dict[str, Any]:
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _build_queries(query: str) -> List[str]:
    primary, _seeds, alts = _extract_seed_urls(query)
    raw = str(primary or query or "").strip()
    # Strip IA-advanced syntax for general web engines
    plain = re.sub(r"creator:\([^)]+\)", " ", raw, flags=re.I)
    plain = re.sub(r"mediatype:\w+", "", plain, flags=re.I)
    plain = re.sub(r"format:\([^)]+\)|format:\"[^\"]+\"|format:\w+", "", plain, flags=re.I)
    plain = re.sub(r"\s+AND\s+", " ", plain, flags=re.I)
    plain = re.sub(r"[()]", " ", plain)
    plain = re.sub(r"\s+", " ", plain).strip() or "Ancient Egypt PDF"
    out: List[str] = []
    if plain:
        out.append(f"{plain[:140]} filetype:pdf" if "filetype:" not in plain.lower() else plain[:160])
        out.append(f"{plain[:120]} PDF")
        if '"' not in plain and " " in plain:
            out.append(f'"{plain[:100]}" PDF')
    for a in alts[:4]:
        if a and a not in out:
            out.append(a if "pdf" in a.lower() or "filetype:" in a.lower() else f"{a} PDF")
    # Prefer author name if present
    if re.search(r"\bpetrie\b|\bflinders\b", plain, re.I):
        base = "Flinders Petrie"
        if re.search(r"\babydos\b", plain, re.I):
            base += " Abydos"
        if re.search(r"\bheliopolis\b|\biunu\b", plain, re.I):
            base += " Heliopolis"
        if re.search(r"\bgiza\b|\bgizeh\b", plain, re.I):
            base += " Giza"
        if re.search(r"\bexcavation\b|\breport\b", plain, re.I):
            base += " excavation report"
        out.extend([f"{base} filetype:pdf", f"{base} PDF"])
    # Dedupe
    seen = set()
    uniq: List[str] = []
    for q in out:
        k = q.strip().lower()
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(q.strip()[:180])
    return uniq or [f"{plain[:120]} filetype:pdf"]


def _search_searxng(q: str, *, page: int = 1, errors: List[str]) -> List[Dict[str, str]]:
    try:
        params = urllib.parse.urlencode({"q": q, "format": "json", "pageno": page})
        data = _http_json(f"{_searxng_base()}/search?{params}")
        out: List[Dict[str, str]] = []
        for r in data.get("results") or []:
            url = str(r.get("url") or "").strip()
            if not url:
                continue
            out.append({
                "url": url,
                "title": str(r.get("title") or url)[:240],
                "snippet": str(r.get("content") or r.get("snippet") or "")[:500],
                "engine": "searxng",
            })
        return out
    except Exception as exc:
        errors.append(f"web_pdf_searxng:{exc}")
        return []


def _search_serper(q: str, *, errors: List[str]) -> List[Dict[str, str]]:
    key = _serper_key()
    if not key:
        return []
    try:
        payload = json.dumps({"q": q, "num": 20}).encode("utf-8")
        data = _http_json(
            "https://google.serper.dev/search",
            method="POST",
            body=payload,
            headers={"Content-Type": "application/json", "X-API-KEY": key},
        )
        out: List[Dict[str, str]] = []
        for r in data.get("organic") or []:
            url = str(r.get("link") or "").strip()
            if not url:
                continue
            out.append({
                "url": url,
                "title": str(r.get("title") or url)[:240],
                "snippet": str(r.get("snippet") or "")[:500],
                "engine": "serper",
            })
        # Serper sometimes returns files separately
        for r in data.get("files") or []:
            url = str(r.get("link") or r.get("url") or "").strip()
            if not url:
                continue
            out.append({
                "url": url,
                "title": str(r.get("title") or url)[:240],
                "snippet": str(r.get("snippet") or "")[:500],
                "engine": "serper_files",
            })
        return out
    except Exception as exc:
        errors.append(f"web_pdf_serper:{exc}")
        return []


def _looks_pdf_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.endswith(".pdf") or ".pdf?" in url.lower() or "/download/" in path


def _probe_pdf(url: str) -> Tuple[bool, str]:
    """Return (is_pdf, reason). Prefer HEAD; fall back to ranged GET."""
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    # HEAD
    try:
        req = urllib.request.Request(url, headers=headers, method="HEAD")
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT) as resp:
            ctype = str(resp.headers.get("Content-Type") or "").lower()
            clen = resp.headers.get("Content-Length")
            if "application/pdf" in ctype or "pdf" in ctype:
                if clen and int(clen) > MAX_PDF_BYTES:
                    return False, "too_large"
                return True, "head_content_type"
            if "text/html" in ctype:
                return False, "html"
            # Do not trust URL alone without Content-Type / magic (avoids .zip false positives)
            if _looks_pdf_url(url) and "octet-stream" in ctype:
                return True, "head_url_octet"
    except Exception:
        pass
    # Ranged GET — check magic bytes
    try:
        hdrs = {**headers, "Range": "bytes=0-1023"}
        req = urllib.request.Request(url, headers=hdrs, method="GET")
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT) as resp:
            ctype = str(resp.headers.get("Content-Type") or "").lower()
            chunk = resp.read(8)
            if chunk.startswith(b"%PDF"):
                return True, "magic"
            if "application/pdf" in ctype:
                return True, "get_content_type"
            if "text/html" in ctype:
                return False, "html"
    except Exception as exc:
        return False, f"probe_fail:{exc}"
    if _looks_pdf_url(url):
        # Last chance: try downloading a small amount via full helper
        data = download_document(url, timeout=PROBE_TIMEOUT)
        if data and data[:4] == b"%PDF":
            if len(data) > MAX_PDF_BYTES:
                return False, "too_large"
            return True, "download_magic"
        return False, "not_pdf"
    return False, "unknown"


def _source_id_for(url: str) -> str:
    host = urlparse(url).netloc.replace(":", "_")[:40]
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return f"web_{host}_{digest}"


def _row_pdf(hit: Dict[str, str], site_id: Optional[str], query: str = "") -> Dict[str, Any]:
    url = hit["url"]
    title = hit.get("title") or url
    snippet = hit.get("snippet") or ""
    text = "\n".join(
        x for x in (
            title,
            f"Source: {url}",
            f"Found via: {hit.get('engine') or 'web'}",
            snippet,
        ) if x
    )
    meta_extra: Dict[str, Any] = {
        "kind": "literature",
        "literature_role": "web_pdf",
        "seek_engine": hit.get("engine"),
        "seek_host": urlparse(url).netloc,
        "snippet": snippet[:400],
    }
    try:
        from ..author_meta import enrich_meta
        meta_extra, _authors, _changed = enrich_meta(
            meta_extra,
            str(title),
            query=str(query or ""),
            source="web_pdf_row",
        )
    except Exception:
        pass
    return {
        "source": CONNECTOR_ID,
        "source_id": _source_id_for(url),
        "source_url": url,
        "title": title[:300],
        "culture": "egyptian",
        "official_text": text,
        "image_url": "",
        "document_url": url,
        "document_ext": ".pdf",
        "site": site_id,
        "period": "",
        "license": "Open-web download — verify rights before redistribution",
        "connector": CONNECTOR_ID,
        "is_stub": False,
        "allow_without_image": True,
        "meta_extra": meta_extra,
    }


def _row_gap(hit: Dict[str, str], site_id: Optional[str], reason: str) -> Dict[str, Any]:
    url = hit["url"]
    title = hit.get("title") or url
    return {
        "source": CONNECTOR_ID,
        "source_id": f"gap_{_source_id_for(url)}",
        "source_url": url,
        "title": f"[gap] {title}"[:300],
        "culture": "egyptian",
        "official_text": f"{title}\nURL: {url}\nGap: {reason}\n{(hit.get('snippet') or '')}",
        "image_url": "",
        "document_url": "",
        "document_ext": "",
        "site": site_id,
        "period": "",
        "license": "link-only candidate",
        "connector": CONNECTOR_ID,
        "is_stub": False,
        "allow_without_image": True,
        "meta_extra": {
            "kind": "source_candidate",
            "literature_role": "web_pdf_gap",
            "gap_reason": reason,
            "seek_engine": hit.get("engine"),
            "seek_host": urlparse(url).netloc,
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
    site_id = (site or {}).get("id")
    limit = max(1, min(int(limit or 15), 80))
    primary, seed_urls, _alts = _extract_seed_urls(query)
    queries = _build_queries(query)

    pdf_rows: List[Dict[str, Any]] = []
    gap_rows: List[Dict[str, Any]] = []
    hosts: Dict[str, int] = {}
    seen_urls: set = set()

    # Operator / curated seeds first — direct probe, skip summary mills.
    for url in seed_urls:
        if len(pdf_rows) >= limit:
            break
        if url in seen_urls:
            continue
        seen_urls.add(url)
        if _host_denied(url):
            errors.append(f"web_pdf_denylist:{urlparse(url).netloc}")
            gap_rows.append(_row_gap({"url": url, "title": url, "snippet": "", "engine": "seed"}, site_id, "summary_mill_denylist"))
            continue
        probe_url = url
        if "archive.org/details/" in url:
            ia_id = url.rstrip("/").split("/")[-1].split("?")[0]
            probe_url = f"https://archive.org/download/{ia_id}/{ia_id}.pdf"
        polite_sleep(0.1)
        ok, reason = _probe_pdf(probe_url)
        host = urlparse(probe_url).netloc
        hosts[host] = hosts.get(host, 0) + 1
        hit = {"url": probe_url if ok else url, "title": url, "snippet": "seed_url", "engine": "seed"}
        if ok:
            pdf_rows.append(_row_pdf(hit, site_id, query=primary or query))
            errors.append(f"web_pdf_ok:{host}")
            errors.append("web_pdf_seed_hit:1")
        else:
            if probe_url != url:
                ok2, reason2 = _probe_pdf(url)
                if ok2:
                    hit2 = {"url": url, "title": url, "snippet": "seed_url", "engine": "seed"}
                    pdf_rows.append(_row_pdf(hit2, site_id, query=primary or query))
                    errors.append(f"web_pdf_ok:{urlparse(url).netloc}")
                    continue
                reason = f"{reason}|{reason2}"
            gap_rows.append(_row_gap(hit, site_id, reason))
            errors.append(f"web_pdf_gap:{host}:{reason}")

    url_only = bool(seed_urls) and not (primary or "").strip()
    if url_only:
        # Seed-only query: never keyword-search the literal "SEED_URL:…" string
        # (it returns garbage like seed catalogues). Non-PDF seeds are web_text's job.
        errors.append("web_pdf_search_hits:0")
        errors.append(f"web_pdf_pdfs:{len(pdf_rows)}")
        errors.append(f"web_pdf_gaps:{len(gap_rows)}")
        if hosts:
            errors.append("web_pdf_hosts:" + ",".join(list(hosts.keys())[:20]))
        if pdf_rows:
            return pdf_rows[:limit]
        return gap_rows[: min(4, limit)]

    hits: List[Dict[str, str]] = []

    for q in queries:
        if url_only and not q:
            continue
        polite_sleep(0.2)
        batch = _search_searxng(q, page=1, errors=errors)
        if not batch:
            batch = _search_serper(q, errors=errors)
        else:
            polite_sleep(0.25)
            batch += _search_searxng(q, page=2, errors=errors)
        for h in batch:
            u = h["url"]
            if u in seen_urls:
                continue
            if _host_denied(u):
                errors.append(f"web_pdf_denylist:{urlparse(u).netloc}")
                continue
            seen_urls.add(u)
            hits.append(h)
        if len(hits) >= max(limit * 3, 30):
            break

    errors.append(f"web_pdf_search_hits:{len(hits)}")
    if not hits and not pdf_rows:
        errors.append("web_pdf_no_search_results")
        if gap_rows:
            return gap_rows[: min(8, limit)]
        return []

    hits.sort(key=lambda h: (0 if _looks_pdf_url(h["url"]) else 1, h["url"]))

    for hit in hits:
        if len(pdf_rows) >= limit:
            break
        url = hit["url"]
        if _host_denied(url):
            continue
        host = urlparse(url).netloc
        hosts[host] = hosts.get(host, 0) + 1
        polite_sleep(0.15)
        ok, reason = _probe_pdf(url)
        if ok:
            pdf_rows.append(_row_pdf(hit, site_id, query=primary or query))
            errors.append(f"web_pdf_ok:{host}")
        else:
            gap_rows.append(_row_gap(hit, site_id, reason))
            errors.append(f"web_pdf_gap:{host}:{reason}")

    gap_budget = max(0, min(8, limit // 2))
    out = pdf_rows[:limit]
    for g in gap_rows[:gap_budget]:
        if len(out) >= limit:
            break
        out.append(g)

    errors.append(f"web_pdf_pdfs:{len(pdf_rows)}")
    errors.append(f"web_pdf_gaps:{len(gap_rows)}")
    if hosts:
        errors.append("web_pdf_hosts:" + ",".join(list(hosts.keys())[:20]))
    return out


def searxng_health() -> Dict[str, Any]:
    """Lightweight health probe for open-web seek."""
    base = _searxng_base()
    try:
        params = urllib.parse.urlencode({"q": "test", "format": "json", "pageno": 1})
        data = _http_json(f"{base}/search?{params}", timeout=min(8.0, SEARCH_TIMEOUT))
        n = len(data.get("results") or [])
        return {"ok": True, "engine": "searxng", "base": base, "sample_hits": n, "serper_configured": bool(_serper_key())}
    except Exception as exc:
        return {
            "ok": False,
            "engine": "searxng",
            "base": base,
            "error": str(exc)[:200],
            "serper_configured": bool(_serper_key()),
        }
