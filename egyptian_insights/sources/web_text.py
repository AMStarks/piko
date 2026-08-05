"""Word-for-word HTML text-site scraper.

Given a SEED_URL that serves text/html (an online book's index page, e.g.
sacred-texts.com/egy/pyt/), crawl the same-directory chapter links in page order,
extract the text verbatim (no summarising), concatenate into ONE .txt file in the
documents dir, and return a single harvest row for the whole book.

Only acts on explicit SEED_URL queries — it is an ingester, not a search engine.
"""
from __future__ import annotations

import hashlib
import html as html_mod
import os
import re
import time
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

from .base import USER_AGENT, polite_sleep
from .web_pdf import _extract_seed_urls, _host_denied

CONNECTOR_ID = "web_text"

MAX_PAGES = int(os.environ.get("PIKO_EI_WEBTEXT_MAX_PAGES") or 300)
MAX_TOTAL_BYTES = int(os.environ.get("PIKO_EI_WEBTEXT_MAX_BYTES") or 30_000_000)
PAGE_DELAY = float(os.environ.get("PIKO_EI_WEBTEXT_DELAY") or 0.7)
TIME_BUDGET_S = float(os.environ.get("PIKO_EI_WEBTEXT_TIME_BUDGET_S") or 240.0)
FETCH_TIMEOUT = float(os.environ.get("PIKO_EI_WEBTEXT_FETCH_TIMEOUT") or 30.0)
MIN_PAGE_TEXT = 80  # skip nav-only pages
OFFICIAL_TEXT_CHARS = 12_000  # DB text column excerpt; full text lives in the .txt

_SKIP_EXT = re.compile(
    r"\.(jpe?g|png|gif|webp|svg|ico|css|js|pdf|zip|mp3|mp4|epub|mobi|woff2?)([?#]|$)", re.I,
)


def _fetch(url: str) -> Tuple[str, str]:
    """Return (content_type, body_text)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        ctype = str(resp.headers.get("Content-Type") or "").lower()
        raw = resp.read(4_000_000)
    charset = "utf-8"
    m = re.search(r"charset=([a-zA-Z0-9_\-]+)", ctype)
    if m:
        charset = m.group(1)
    try:
        body = raw.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        body = raw.decode("utf-8", errors="replace")
    return ctype, body


def probe_html(url: str) -> Tuple[bool, str]:
    """(is_html, reason) — HEAD first, ranged GET fallback."""
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    try:
        req = urllib.request.Request(url, headers=headers, method="HEAD")
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            ctype = str(resp.headers.get("Content-Type") or "").lower()
            if "text/html" in ctype or "application/xhtml" in ctype:
                return True, "head_content_type"
            if ctype:
                return False, ctype.split(";")[0].strip() or "non_html"
    except Exception:
        pass
    try:
        req = urllib.request.Request(url, headers={**headers, "Range": "bytes=0-2047"})
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            ctype = str(resp.headers.get("Content-Type") or "").lower()
            chunk = resp.read(2048)
            if "text/html" in ctype or chunk.lstrip()[:64].lower().startswith((b"<!doctype", b"<html")):
                return True, "get_probe"
            return False, ctype.split(";")[0].strip() or "non_html"
    except Exception as exc:
        return False, f"probe_fail:{exc}"


def html_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not m:
        return ""
    return re.sub(r"\s+", " ", html_mod.unescape(m.group(1))).strip()[:240]


def html_to_text(html: str) -> str:
    """Verbatim text extraction. BeautifulSoup when available, regex fallback."""
    try:
        from bs4 import BeautifulSoup  # type: ignore

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "head", "nav", "noscript", "iframe", "form"]):
            tag.decompose()
        text = soup.get_text("\n")
    except Exception:
        text = html
        text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
        text = re.sub(r"<(script|style|head|nav|noscript|iframe|form)\b.*?</\1\s*>", " ", text, flags=re.I | re.S)
        # Block-level tags become newlines so paragraphs survive tag-stripping.
        text = re.sub(r"<(br|/p|/div|/h[1-6]|/tr|/li|/blockquote|/table|hr)\b[^>]*>", "\n", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html_mod.unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _crawl_prefix(index_url: str) -> str:
    """Directory of the index page, e.g. https://host/egy/pyt/."""
    p = urlparse(index_url)
    path = p.path or "/"
    if not path.endswith("/"):
        path = path.rsplit("/", 1)[0] + "/"
    return f"{p.scheme}://{p.netloc}{path}"


def collect_links(html: str, index_url: str) -> List[str]:
    """Same-directory page links from the index, document order, deduped."""
    prefix = _crawl_prefix(index_url)
    index_norm = index_url.split("#")[0].split("?")[0]
    seen: set = set()
    out: List[str] = []
    for m in re.finditer(r"""<a\s[^>]*href\s*=\s*["']([^"'#]+)["']""", html, re.I):
        href = m.group(1).strip()
        if not href or href.lower().startswith(("javascript:", "mailto:", "data:")):
            continue
        absu = urljoin(index_url, href).split("#")[0].split("?")[0]
        if not absu.startswith(prefix):
            continue
        if absu == index_norm or absu == prefix:
            continue
        if _SKIP_EXT.search(absu):
            continue
        if absu in seen:
            continue
        seen.add(absu)
        out.append(absu)
    return out


def crawl_text_site(index_url: str, *, errors: Optional[List[str]] = None) -> Dict[str, Any]:
    """Crawl index + chapter pages → verbatim concatenated text."""
    errors = errors if errors is not None else []
    started = time.time()
    ctype, index_html = _fetch(index_url)
    if "html" not in ctype and not index_html.lstrip()[:64].lower().startswith(("<!doctype", "<html")):
        return {"ok": False, "error": f"index_not_html:{ctype}"}

    title = html_title(index_html) or index_url
    links = collect_links(index_html, index_url)[:MAX_PAGES]
    parts: List[str] = []
    index_text = html_to_text(index_html)
    if index_text:
        parts.append(f"=== INDEX: {index_url} ===\n\n{index_text}")

    pages_ok = 0
    pages_failed = 0
    total = sum(len(p) for p in parts)
    truncated = None
    for page_url in links:
        if time.time() - started > TIME_BUDGET_S:
            truncated = "time_budget"
            break
        if total >= MAX_TOTAL_BYTES:
            truncated = "byte_cap"
            break
        polite_sleep(PAGE_DELAY)
        try:
            pctype, phtml = _fetch(page_url)
        except Exception as exc:
            pages_failed += 1
            errors.append(f"web_text_page_fail:{page_url.rsplit('/', 1)[-1]}:{exc}")
            continue
        if "html" not in pctype:
            pages_failed += 1
            continue
        ptext = html_to_text(phtml)
        if len(ptext) < MIN_PAGE_TEXT:
            continue
        parts.append(f"=== {page_url} ===\n\n{ptext}")
        total += len(ptext)
        pages_ok += 1

    text = "\n\n\n".join(parts).strip()
    return {
        "ok": bool(text) and (pages_ok > 0 or len(text) >= 1000),
        "title": title,
        "text": text,
        "index_url": index_url,
        "crawl_prefix": _crawl_prefix(index_url),
        "links_found": len(links),
        "pages_scraped": pages_ok,
        "pages_failed": pages_failed,
        "truncated": truncated,
        "text_chars": len(text),
        "elapsed_s": round(time.time() - started, 1),
    }


def _source_id_for(url: str) -> str:
    host = urlparse(url).netloc.replace(":", "_")[:40]
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return f"webtext_{host}_{digest}"


def _write_document(index_url: str, crawl: Dict[str, Any]) -> Tuple[str, int]:
    from .. import db

    digest = hashlib.sha1(index_url.encode("utf-8")).hexdigest()[:16]
    dest = db.documents_dir() / f"webtext_{digest}.txt"
    header = (
        f"{crawl.get('title') or index_url}\n"
        f"Source: {index_url}\n"
        f"Scraped word-for-word by Piko EI web_text connector "
        f"({crawl.get('pages_scraped')} pages, {crawl.get('text_chars')} chars)\n"
        f"{'=' * 72}\n\n"
    )
    body = header + str(crawl.get("text") or "")
    data = body.encode("utf-8")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return str(dest), len(data)


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Ingest HTML seed URLs. No open-web searching — SEED_URL only."""
    errors = errors if errors is not None else []
    site_id = (site or {}).get("id")
    _primary, seed_urls, _alts = _extract_seed_urls(query)
    if not seed_urls:
        return []

    rows: List[Dict[str, Any]] = []
    for url in seed_urls[:2]:
        if len(rows) >= max(1, limit):
            break
        host = urlparse(url).netloc
        if _host_denied(url):
            errors.append(f"web_text_denylist:{host}")
            continue
        is_html, reason = probe_html(url)
        if not is_html:
            errors.append(f"web_text_skip:{host}:{reason}")
            continue
        try:
            crawl = crawl_text_site(url, errors=errors)
        except Exception as exc:
            errors.append(f"web_text_crawl_fail:{host}:{exc}")
            continue
        if not crawl.get("ok"):
            errors.append(f"web_text_thin:{host}:{crawl.get('error') or crawl.get('text_chars')}")
            continue
        doc_path, doc_bytes = _write_document(url, crawl)
        title = str(crawl.get("title") or url)
        excerpt = str(crawl.get("text") or "")[:OFFICIAL_TEXT_CHARS]
        official = (
            f"{title}\nSource: {url}\n"
            f"Word-for-word site scrape: {crawl.get('pages_scraped')} pages, "
            f"{crawl.get('text_chars')} chars (full text in attached document).\n\n{excerpt}"
        )
        meta_extra: Dict[str, Any] = {
            "kind": "literature",
            "literature_role": "web_text",
            "seek_host": host,
            "crawl_prefix": crawl.get("crawl_prefix"),
            "pages_scraped": crawl.get("pages_scraped"),
            "pages_failed": crawl.get("pages_failed"),
            "links_found": crawl.get("links_found"),
            "crawl_truncated": crawl.get("truncated"),
            "text_chars_total": crawl.get("text_chars"),
            "verbatim": True,
        }
        try:
            from ..author_meta import enrich_meta

            meta_extra, _authors, _changed = enrich_meta(
                meta_extra, title, query=str(query or ""), source="web_text_row",
            )
        except Exception:
            pass
        rows.append({
            "source": CONNECTOR_ID,
            "source_id": _source_id_for(url),
            "source_url": url,
            "title": title[:300],
            "culture": "egyptian",
            "official_text": official,
            "image_url": "",
            "document_url": url,
            "document_ext": ".txt",
            "document_local_path": doc_path,
            "site": site_id,
            "period": "",
            "license": "Web text scrape — verify rights before redistribution",
            "connector": CONNECTOR_ID,
            "is_stub": False,
            "allow_without_image": True,
            "meta_extra": meta_extra,
        })
        errors.append(f"web_text_ok:{host}:{crawl.get('pages_scraped')}p:{crawl.get('text_chars')}c")
    return rows[:limit]
