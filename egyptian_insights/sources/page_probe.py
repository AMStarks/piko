"""Cheap URL probe → page card for ingest routing.

Classify a seed URL as a downloadable document (PDF / TEI / XML / TXT)
or HTML. When HTML offers a full-text download/export link, prefer that
over a multi-page viewer crawl.

No host allowlists — generic href / Content-Type / rel=alternate signals.
"""
from __future__ import annotations

import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlparse


PROBE_TIMEOUT = float(__import__("os").environ.get("PIKO_EI_PROBE_TIMEOUT") or 30.0)
PROBE_MAX_BYTES = int(__import__("os").environ.get("PIKO_EI_PROBE_MAX_BYTES") or 2_500_000)
FETCH_UA = (
    __import__("os").environ.get("PIKO_EI_DOCUMENT_UA")
    or "Mozilla/5.0 (compatible; PikoFetchDocument/1.0) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

_DOWNLOAD_LEAF_RE = re.compile(
    r"(dltext|download|export|fulltext|full[-_]?text|gettext|plaintext|rawtext|tei)(\.|$|/|\?)",
    re.I,
)
_DOWNLOAD_EXT_RE = re.compile(r"\.(xml|txt|tei|pdf|epub)([?#]|$)", re.I)
_SKIP_DOWNLOAD_LEAF = {
    "xmltoc", "nebrowser", "morph", "entityvote", "vocablist", "cite",
    "search", "loadquery", "xmlchunk", "disppref",
}
# Archive.org catalog/sidecar XML — not the book. Prefer PDF / djvu.txt / TEI.
_JUNK_DOWNLOAD_RE = re.compile(
    r"(archive_marc|_meta\.xml|_files\.xml|_reviews\.xml|_djvu\.xml|_marc\.xml)([?#]|$)",
    re.I,
)
_FORMAT_QUERY_OK = {"xml", "txt", "text", "tei", "plain", "plaintext", "pdf"}
_LINK_RE = re.compile(r"""<link\s[^>]*>""", re.I)


def _headers(accept: str = "*/*") -> Dict[str, str]:
    return {
        "User-Agent": FETCH_UA,
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
    }


def fetch_bytes(url: str, *, timeout: Optional[float] = None, max_bytes: Optional[int] = None) -> Tuple[str, bytes]:
    """GET url → (content_type, body)."""
    req = urllib.request.Request(url, headers=_headers(
        "application/pdf,application/xml,text/xml,text/plain,text/html,application/xhtml+xml,*/*;q=0.8"
    ))
    cap = int(max_bytes if max_bytes is not None else PROBE_MAX_BYTES)
    with urllib.request.urlopen(req, timeout=timeout or PROBE_TIMEOUT) as resp:
        ctype = str(resp.headers.get("Content-Type") or "").lower()
        body = resp.read(cap)
    return ctype, body


def _ctype_kind(ctype: str, body: bytes) -> str:
    c = (ctype or "").split(";")[0].strip().lower()
    head = (body or b"")[:16].lstrip()
    if c == "application/pdf" or head.startswith(b"%PDF"):
        return "pdf"
    if c in ("application/xml", "text/xml", "application/tei+xml", "application/tei") or (
        head.startswith(b"<?xml") or head.startswith(b"<TEI") or head.startswith(b"<tei")
    ):
        return "xml_document"
    if c in ("text/plain", "text/markdown") or (
        c.startswith("text/") and b"<html" not in head[:64].lower() and not head.startswith(b"<")
    ):
        if head.startswith(b"<!doctype") or head[:64].lower().startswith(b"<html"):
            return "html"
        if c.startswith("text/html"):
            return "html"
        if c in ("text/plain", "text/markdown"):
            return "plain_text"
    if "html" in c or head[:64].lower().startswith((b"<!doctype", b"<html")):
        return "html"
    if head.startswith(b"<?xml") or head[:8].lower().startswith(b"<tei"):
        return "xml_document"
    return "unknown"


def _leaf(url: str) -> str:
    path = urlparse(url).path or ""
    parts = [p for p in path.split("/") if p]
    return (parts[-1] if parts else "").lower()


def _download_hint(url: str, *, rel: str = "", type_attr: str = "") -> Optional[str]:
    """Return tei_xml | xml | txt | pdf | None."""
    parsed = urlparse(url)
    path = (parsed.path or "").lower()
    leaf = _leaf(url)
    if leaf in _SKIP_DOWNLOAD_LEAF or any(seg in _SKIP_DOWNLOAD_LEAF for seg in path.split("/")):
        return None
    if _JUNK_DOWNLOAD_RE.search(path) or _JUNK_DOWNLOAD_RE.search(leaf):
        return None
    q = {k.lower(): (v[0] if v else "") for k, v in parse_qs(parsed.query).items()}
    type_l = (type_attr or "").lower()
    rel_l = (rel or "").lower()

    if "pdf" in type_l or path.endswith(".pdf") or q.get("format", "").lower() == "pdf":
        return "pdf"
    if "tei" in type_l or path.endswith(".tei") or "tei" in q.get("format", "").lower():
        return "tei_xml"
    if "xml" in type_l or path.endswith(".xml") or q.get("format", "").lower() in ("xml", "tei"):
        return "xml"
    if "text/plain" in type_l or path.endswith(".txt") or q.get("format", "").lower() in (
        "txt", "text", "plain", "plaintext",
    ):
        return "txt"

    if "dltext" in path or "dltext" in leaf:
        return "tei_xml"
    if _DOWNLOAD_EXT_RE.search(path):
        ext = _DOWNLOAD_EXT_RE.search(path).group(1).lower()
        return {"pdf": "pdf", "txt": "txt", "tei": "tei_xml", "xml": "xml", "epub": "xml"}.get(ext)
    if _DOWNLOAD_LEAF_RE.search(path) or _DOWNLOAD_LEAF_RE.search(leaf):
        fmt = (q.get("format") or q.get("output") or q.get("type") or "").lower()
        if fmt in ("pdf",):
            return "pdf"
        if fmt in ("txt", "text", "plain", "plaintext"):
            return "txt"
        return "xml"
    if rel_l == "alternate" and any(x in type_l for x in ("xml", "tei", "plain", "pdf")):
        if "pdf" in type_l:
            return "pdf"
        if "plain" in type_l:
            return "txt"
        if "tei" in type_l:
            return "tei_xml"
        return "xml"
    fmt = (q.get("format") or q.get("output") or "").lower()
    if fmt in _FORMAT_QUERY_OK:
        if fmt == "pdf":
            return "pdf"
        if fmt in ("txt", "text", "plain", "plaintext"):
            return "txt"
        if fmt == "tei":
            return "tei_xml"
        return "xml"
    return None


def _score_hint(hint: str) -> int:
    # TEI full-text still beats everything (Perseus). IA _djvu.txt OCR beats
    # image PDFs (web_pdf often extracts a 200-char wrapper, not the book).
    return {"tei_xml": 70, "txt": 68, "pdf": 60, "xml": 20}.get(hint, 0)


def extract_download_links(html: str, base_url: str) -> List[Dict[str, str]]:
    """Download/export/full-text candidates from HTML, best-first."""
    found: List[Dict[str, str]] = []
    seen = set()

    def add(href: str, *, rel: str = "", type_attr: str = "", label: str = "") -> None:
        if not href or href.lower().startswith(("javascript:", "mailto:", "data:")):
            return
        absu = urljoin(base_url, href).split("#")[0]
        if absu in seen:
            return
        hint = _download_hint(absu, rel=rel, type_attr=type_attr)
        if not hint:
            return
        seen.add(absu)
        found.append({"url": absu, "hint": hint, "label": (label or "")[:80], "rel": rel})

    for m in re.finditer(
        r"""<a\s([^>]+)>(.*?)</a>""",
        html,
        re.I | re.S,
    ):
        attrs, inner = m.group(1), m.group(2)
        hm = re.search(r"""href\s*=\s*["']([^"']+)["']""", attrs, re.I)
        if not hm:
            continue
        rel_m = re.search(r"""rel\s*=\s*["']([^"']+)["']""", attrs, re.I)
        typ_m = re.search(r"""type\s*=\s*["']([^"']+)["']""", attrs, re.I)
        label = re.sub(r"<[^>]+>", " ", inner)
        label = re.sub(r"\s+", " ", label).strip()
        add(hm.group(1), rel=(rel_m.group(1) if rel_m else ""), type_attr=(typ_m.group(1) if typ_m else ""), label=label)

    for m in _LINK_RE.finditer(html):
        tag = m.group(0)
        hm = re.search(r"""href\s*=\s*["']([^"']+)["']""", tag, re.I)
        if not hm:
            continue
        rel_m = re.search(r"""rel\s*=\s*["']([^"']+)["']""", tag, re.I)
        typ_m = re.search(r"""type\s*=\s*["']([^"']+)["']""", tag, re.I)
        add(hm.group(1), rel=(rel_m.group(1) if rel_m else ""), type_attr=(typ_m.group(1) if typ_m else ""))

    found.sort(key=lambda d: -_score_hint(d.get("hint") or ""))
    return found


def html_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html or "", re.I | re.S)
    if not m:
        return ""
    import html as html_mod
    return re.sub(r"\s+", " ", html_mod.unescape(m.group(1))).strip()[:240]


def _toc_link_count(html: str, base_url: str) -> int:
    host = (urlparse(base_url).netloc or "").lower()
    n = 0
    for m in re.finditer(r"""href\s*=\s*["']([^"'#]+)["']""", html or "", re.I):
        href = m.group(1).strip()
        if not href or href.lower().startswith(("javascript:", "mailto:")):
            continue
        absu = urljoin(base_url, href)
        if (urlparse(absu).netloc or "").lower() != host:
            continue
        n += 1
    return n


def probe_url(url: str) -> Dict[str, Any]:
    """Return a page card: kind, content_type, download_urls, preferred_fetch_url, title."""
    card: Dict[str, Any] = {
        "url": url,
        "kind": "unknown",
        "content_type": "",
        "download_urls": [],
        "preferred_fetch_url": url,
        "preferred_hint": None,
        "toc_link_count": None,
        "title": "",
        "error": None,
    }
    try:
        ctype, body = fetch_bytes(url)
    except urllib.error.HTTPError as exc:
        card["error"] = f"http_{exc.code}"
        return card
    except Exception as exc:
        card["error"] = str(exc)[:200]
        return card

    card["content_type"] = ctype
    kind = _ctype_kind(ctype, body)
    card["kind"] = kind
    if kind == "pdf":
        card["preferred_hint"] = "pdf"
        return card
    if kind == "xml_document":
        card["preferred_hint"] = "tei_xml" if b"<tei" in body[:400].lower() or b"<TEI" in body[:400] else "xml"
        return card
    if kind == "plain_text":
        card["preferred_hint"] = "txt"
        return card
    if kind != "html":
        return card

    try:
        html = body.decode("utf-8", errors="replace")
    except Exception:
        html = body.decode("latin-1", errors="replace")
    card["title"] = html_title(html)
    downloads = extract_download_links(html, url)
    card["download_urls"] = downloads[:12]
    card["toc_link_count"] = _toc_link_count(html, url)
    if downloads:
        best = downloads[0]
        card["kind"] = "html_with_download"
        card["preferred_fetch_url"] = best["url"]
        card["preferred_hint"] = best.get("hint")
        return card
    toc = card["toc_link_count"] or 0
    if toc >= 5:
        card["kind"] = "html_book_toc"
    else:
        card["kind"] = "html_page"
    return card


def choose_connector(card: Dict[str, Any]) -> Optional[str]:
    """Map a page card to one harvest connector, or None to keep caller sources."""
    kind = str((card or {}).get("kind") or "")
    hint = str((card or {}).get("preferred_hint") or "")
    if kind == "pdf" or hint == "pdf":
        return "web_pdf"
    if kind in ("xml_document", "plain_text", "html_with_download") or hint in ("tei_xml", "xml", "txt"):
        return "web_document"
    if kind in ("html_book_toc", "html_page"):
        return "web_text"
    return None


def should_auto_route(sources: Optional[List[str]], auto_route: Any = True) -> bool:
    if auto_route is False or str(auto_route).lower() in ("0", "false", "no", "off"):
        return False
    src = [str(s) for s in (sources or []) if str(s).strip()]
    if src == ["web_text"] or src == ["web_pdf"] or src == ["archive_org"]:
        return False
    ingest_mix = {"web_pdf", "web_text", "web_document", "archive_org"}
    return (not src) or set(src) <= ingest_mix or "web_document" in src or "web_text" in src
