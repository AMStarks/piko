"""One-shot full-document ingest (PDF handled by web_pdf; this takes TEI/XML/TXT).

Given a SEED_URL, probe the page. If it is already a document, or HTML that
offers a download/export/full-text link, fetch that file once, extract text,
and persist a single harvest row. No HTML BFS.
"""
from __future__ import annotations

import hashlib
import html as html_mod
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from . import page_probe
from .web_pdf import _extract_seed_urls, _host_denied

CONNECTOR_ID = "web_document"
OFFICIAL_TEXT_CHARS = 50_000
MIN_DOCUMENT_CHARS = 3_000


def xml_document_to_text(xml: str) -> str:
    """TEI / generic XML → readable prose (teiHeader stripped)."""
    raw = str(xml or "")
    try:
        from bs4 import BeautifulSoup  # type: ignore

        soup = BeautifulSoup(raw, "html.parser")
        for tag in soup.find_all(["teiheader", "teiHeader", "header"]):
            tag.decompose()
        for tag in soup.find_all(["script", "style"]):
            tag.decompose()
        text = soup.get_text("\n")
    except Exception:
        text = re.sub(r"(?is)<teiheader\b.*?</teiheader>", " ", raw)
        text = re.sub(r"(?is)<header\b.*?</header>", " ", text)
        text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html_mod.unescape(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def title_from_xml(xml: str, fallback: str = "") -> str:
    blob = str(xml or "")
    author = ""
    title = ""
    am = re.search(r"<author\b[^>]*>(.*?)</author>", blob, re.I | re.S)
    if am:
        author = re.sub(r"<[^>]+>", " ", html_mod.unescape(am.group(1)))
        author = re.sub(r"\s+", " ", author).strip()
    for m in re.finditer(r"<title(\s[^>]*)?>(.*?)</title>", blob, re.I | re.S):
        attrs = m.group(1) or ""
        if re.search(r'type\s*=\s*["\']?(sub|subtitle|short)\b', attrs, re.I):
            continue
        title = re.sub(r"<[^>]+>", " ", html_mod.unescape(m.group(2)))
        title = re.sub(r"\s+", " ", title).strip()
        if title:
            break
    if author and title and author.lower() not in title.lower():
        return f"{author}, {title}"[:300]
    return (title or fallback or "")[:300]


def _source_id_for(url: str) -> str:
    host = urlparse(url).netloc.replace(":", "_")[:40]
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    return f"webdoc_{host}_{digest}"


def _write_document(seed_url: str, text: str, *, title: str, fetch_url: str, fmt: str) -> Tuple[str, int]:
    from .. import db

    digest = hashlib.sha1(seed_url.encode("utf-8")).hexdigest()[:16]
    dest = db.documents_dir() / f"webdoc_{digest}.txt"
    header = (
        f"{title or seed_url}\n"
        f"Source: {seed_url}\n"
        f"Fetched: {fetch_url}\n"
        f"Format: {fmt}\n"
        f"Ingested by Piko fetch_document / web_document connector "
        f"({len(text)} chars)\n"
        f"{'=' * 72}\n\n"
    )
    data = (header + text).encode("utf-8")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return str(dest), len(data)


def _hint_from_ctype(ctype: str, body: bytes) -> str:
    kind = page_probe._ctype_kind(ctype, body)
    if kind == "pdf":
        return "pdf"
    if kind == "plain_text":
        return "txt"
    if kind == "xml_document":
        low = (body[:800] + body[-200:]).lower()
        if b"<tei" in low:
            return "tei_xml"
        return "xml"
    return "xml"


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Ingest SEED_URL as a single document when a full-text file is available."""
    errors = errors if errors is not None else []
    site_id = (site or {}).get("id")
    _primary, seed_urls, _alts = _extract_seed_urls(query)
    if not seed_urls:
        return []

    rows: List[Dict[str, Any]] = []
    for seed in seed_urls[:2]:
        if len(rows) >= max(1, limit):
            break
        host = urlparse(seed).netloc
        if _host_denied(seed):
            errors.append(f"web_document_denylist:{host}")
            continue
        try:
            card = page_probe.probe_url(seed)
        except Exception as exc:
            errors.append(f"web_document_probe_fail:{host}:{exc}")
            continue
        errors.append(
            f"web_document_probe:{card.get('kind')}:{card.get('preferred_hint') or '-'}"
        )
        if card.get("error") and card.get("kind") == "unknown":
            errors.append(f"web_document_probe_error:{host}:{card.get('error')}")
            continue
        connector = page_probe.choose_connector(card)
        if connector == "web_pdf":
            errors.append(f"web_document_defer_pdf:{host}")
            continue
        if connector == "web_text" or card.get("kind") in ("html_book_toc", "html_page", "html"):
            errors.append(f"web_document_no_file:{host}:{card.get('kind')}")
            continue
        fetch_url = str(card.get("preferred_fetch_url") or seed)
        hint = str(card.get("preferred_hint") or "xml")
        try:
            ctype, body = page_probe.fetch_bytes(fetch_url, max_bytes=20_000_000)
        except Exception as exc:
            errors.append(f"web_document_fetch_fail:{host}:{exc}")
            continue
        got_hint = _hint_from_ctype(ctype, body)
        if got_hint == "pdf" or (body[:5] == b"%PDF-"):
            errors.append(f"web_document_defer_pdf_body:{host}")
            continue
        if got_hint == "txt" or (ctype.split(";")[0].strip().lower() == "text/plain"):
            try:
                text = body.decode("utf-8", errors="replace")
            except Exception:
                text = body.decode("latin-1", errors="replace")
            fmt = "plain_text"
            title = (card.get("title") or fetch_url)[:300]
        else:
            try:
                xml = body.decode("utf-8", errors="replace")
            except Exception:
                xml = body.decode("latin-1", errors="replace")
            text = xml_document_to_text(xml)
            fmt = "tei_xml" if got_hint == "tei_xml" or "<tei" in xml[:800].lower() else "xml"
            title = title_from_xml(xml, fallback=str(card.get("title") or seed))

        if len(text) < MIN_DOCUMENT_CHARS:
            errors.append(f"web_document_thin:{host}:{len(text)}")
            continue

        doc_path, doc_bytes = _write_document(seed, text, title=title, fetch_url=fetch_url, fmt=fmt)
        excerpt = text[:OFFICIAL_TEXT_CHARS]
        official = (
            f"{title}\nSource: {seed}\nFetched: {fetch_url}\n"
            f"Full document ({fmt}): {len(text)} chars "
            f"(complete text in attached file).\n\n{excerpt}"
        )
        meta_extra: Dict[str, Any] = {
            "kind": "literature",
            "literature_role": "web_document",
            "connector": CONNECTOR_ID,
            "ingest_route": "fetch_document",
            "document_format": fmt,
            "seek_host": host,
            "seed_url": seed,
            "fetch_url": fetch_url,
            "probe_kind": card.get("kind"),
            "verbatim": True,
            "text_chars_total": len(text),
            "document_bytes": doc_bytes,
            "is_full_document": True,
        }
        try:
            from ..author_meta import enrich_meta

            meta_extra, _authors, _changed = enrich_meta(
                meta_extra, title, query=str(query or ""), source="web_document_row",
            )
        except Exception:
            pass
        culture = str((site or {}).get("culture") or os.environ.get("PIKO_WEBTEXT_CULTURE") or "egyptian")
        rows.append({
            "source": CONNECTOR_ID,
            "source_id": _source_id_for(seed),
            "source_url": seed,
            "title": title[:300] or seed[:300],
            "culture": culture,
            "official_text": official,
            "image_url": "",
            "document_url": fetch_url,
            "document_ext": ".txt",
            "document_local_path": doc_path,
            "site": site_id,
            "period": "",
            "license": "Open-web document — verify rights before redistribution",
            "connector": CONNECTOR_ID,
            "is_stub": False,
            "allow_without_image": True,
            "meta_extra": meta_extra,
        })
        errors.append(f"web_document_ok:{host}:{fmt}:{len(text)}c")
    return rows[:limit]
