"""Author metadata helpers for cultures_cache harvest rows."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


def normalize_author(value: Any) -> Optional[str]:
    s = re.sub(r"\s+", " ", str(value or "")).strip()
    if not s or len(s) < 2 or len(s) > 160:
        return None
    if re.match(r"^(unknown|n/?a|none|null|undefined)$", s, re.I):
        return None
    if re.match(r"^(pdf|http|www\.|archive\.org)", s, re.I):
        return None
    s = re.sub(r"\s*[-–—:]\s*(author|editor|trans(lator)?)\.?$", "", s, flags=re.I).strip()
    if not looks_like_person_name(s):
        return None
    return s or None


def looks_like_person_name(value: str) -> bool:
    s = str(value or "").strip()
    if not s:
        return False
    if re.search(r"\bon the\b", s, re.I):
        return False
    if re.search(
        r"\b(university|library|archive\.org|internet archive|museum|press|institute|college|society|foundation|publisher)\b",
        s,
        re.I,
    ):
        return False
    if re.match(r"^(the|a|an)\s+", s, re.I) and len(s.split()) <= 6 and "," not in s:
        if s == s.upper() or re.search(r"\b(pyramid|temple|tomb|egypt|giza|abydos)\b", s, re.I):
            return False
    parts = s.split()
    if len(parts) == 1 and not re.match(r"^[A-Z]\.?$", parts[0]) and len(parts[0]) < 5:
        return False
    if all(re.match(r"^[A-Z]\.?$", p) for p in parts):
        return False
    return True


def normalize_creator(raw: Any) -> Optional[str]:
    s = str(raw or "").split(";")[0].split("|")[0]
    s = re.sub(r"\s*\([^)]*\)\s*", " ", s)
    s = re.sub(r",?\s*\d{4}\s*[-–—]\s*\d{0,4}.*$", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    m = re.match(r"^([^,]+),\s*(.+)$", s)
    if m:
        last, first = m.group(1).strip(), m.group(2).strip()
        if len(last.split()) <= 4 and len(first.split()) <= 6 and not re.search(r"\d", last):
            return normalize_author(f"{first} {last}")
    return normalize_author(s)


_BY_RE = re.compile(
    r"\b[Bb][Yy]\s+([A-Z][\w.'-]+(?:\s+(?:[A-Z]\.?|[A-Z][\w.'-]+)){0,5})\b",
)
_EM_RE = re.compile(
    r"[—–]\s*([A-Z][\w.'-]+(?:\s+(?:[A-Z]\.?|[A-Z][\w.'-]+)){0,5})\s*(?:\(|$|\[)",
)
_HYPHEN_RE = re.compile(
    r"\s-\s([A-Z][\w.'-]+(?:\s+(?:[A-Z]\.?|[A-Z][\w.'-]+)){1,4})\s*$",
)


def authors_from_title(title: str) -> List[str]:
    t = re.sub(r"\s+", " ", str(title or "")).strip()
    if not t:
        return []
    out: List[str] = []

    def push(v: str) -> None:
        a = normalize_author(v)
        if a and a not in out:
            out.append(a)

    m = _BY_RE.search(t)
    if m:
        push(m.group(1))
    m = _EM_RE.search(t)
    if m:
        push(m.group(1))
    m = _HYPHEN_RE.search(t)
    if m:
        push(m.group(1))
    return out


def authors_from_query(query: str) -> List[str]:
    q = re.sub(r"\s+", " ", str(query or "")).strip()
    if not q:
        return []
    out: List[str] = []
    m = _BY_RE.search(q)
    if m:
        a = normalize_author(m.group(1))
        if a:
            out.append(a)
    return out


def authors_from_meta(meta: Dict[str, Any]) -> List[str]:
    m = meta if isinstance(meta, dict) else {}
    out: List[str] = []

    def push(v: Any, via_creator: bool = False) -> None:
        a = normalize_creator(v) if via_creator else normalize_author(v)
        if a and a not in out:
            out.append(a)

    authors = m.get("authors")
    if isinstance(authors, list):
        for v in authors:
            push(v)
    if m.get("author"):
        push(m.get("author"))
    if m.get("work_author"):
        push(m.get("work_author"))
    if m.get("creator"):
        for part in re.split(r"\s*;\s*|\s+and\s+", str(m.get("creator")), flags=re.I):
            push(part, via_creator=True)
    creators = m.get("creators")
    if isinstance(creators, list):
        for v in creators:
            push(v, via_creator=True)
    return out


def extract_authors(title: str, meta: Optional[Dict[str, Any]] = None, query: str = "") -> List[str]:
    out: List[str] = []
    seen = set()

    def add(items: List[str]) -> None:
        for a in items:
            key = a.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(a)

    add(authors_from_meta(meta or {}))
    add(authors_from_title(title or ""))
    if query:
        add(authors_from_query(query))
    return out


def enrich_meta(
    meta: Optional[Dict[str, Any]],
    title: str,
    *,
    query: str = "",
    force: bool = False,
    source: str = "title_meta_query",
) -> Tuple[Dict[str, Any], List[str], bool]:
    base = dict(meta or {})
    authors = extract_authors(title, base, query=query)
    if not authors:
        return base, [], False

    had = bool(base.get("author") or base.get("authors") or base.get("work_author"))
    if had and not force:
        if not base.get("author"):
            base["author"] = authors[0]
            base["authors"] = authors[:8]
            base["author_enriched_from"] = base.get("author_enriched_from") or "creator_or_title"
            return base, authors, True
        return base, authors, False

    base["author"] = authors[0]
    base["authors"] = authors[:8]
    if force or not base.get("creator"):
        base["creator"] = authors[0]
    base["author_enriched_from"] = source
    base["author_enriched_at"] = datetime.now(timezone.utc).isoformat()
    return base, authors, True
