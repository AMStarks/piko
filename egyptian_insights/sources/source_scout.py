"""Discover egyptology digital archives / bibliographic hubs (source scout).

Finds candidate repositories similar in role to TopBib, TLA, Archive.org, Digital Giza —
not full-text harvest of those sites. Results are stored as kind=source_candidate.
"""
from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from .base import http_get, polite_sleep, query_pack_for_site, text_matches_site

CONNECTOR_ID = "source_scout"

# Curated seeds — known open / scholarly egyptology digital hubs
SEED_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "topbib",
        "title": "Topographical Bibliography (Griffith Institute)",
        "url": "https://topbib.griffith.ox.ac.uk/",
        "tags": ["bibliography", "porter-moss", "sites", "abydos", "heliopolis", "giza"],
        "why": "Porter & Moss topographic bibliography — site → published references.",
    },
    {
        "id": "tla",
        "title": "Thesaurus Linguae Aegyptiae",
        "url": "https://thesaurus-linguae-aegyptiae.de/",
        "tags": ["texts", "lemmata", "inscriptions", "abydos", "heliopolis", "giza"],
        "why": "Lemmatised Egyptian texts and object corpus (BBAW).",
    },
    {
        "id": "archive_org",
        "title": "Internet Archive — texts",
        "url": "https://archive.org/details/texts",
        "tags": ["literature", "excavation", "petrie", "pdf", "ocr", "abydos", "heliopolis", "giza"],
        "why": "Open digitized excavation reports and monographs (OCR + PDF).",
    },
    {
        "id": "digital_giza",
        "title": "Digital Giza / Giza Project",
        "url": "https://giza.fas.harvard.edu/",
        "tags": ["giza", "excavation", "mastaba", "pyramid"],
        "why": "Harvard Giza Plateau documentation and library.",
    },
    {
        "id": "osireion_info",
        "title": "Osireion.info",
        "url": "https://osireion.info/",
        "tags": ["abydos", "oserion", "osireion"],
        "why": "Osireion / Abydos-focused documentation hub.",
    },
    {
        "id": "uei",
        "title": "UCLA Encyclopedia of Egyptology",
        "url": "https://escholarship.org/uc/nelc_uee",
        "tags": ["encyclopedia", "secondary", "abydos", "heliopolis", "giza"],
        "why": "Peer-reviewed Egyptology encyclopedia articles.",
    },
    {
        "id": "propylaeum",
        "title": "Propylaeum — Egyptology",
        "url": "https://www.propylaeum.de/en/egyptology",
        "tags": ["bibliography", "open-access", "literature"],
        "why": "Specialist open-access Egyptology portal / literature.",
    },
    {
        "id": "ifao",
        "title": "IFAO — publications / resources",
        "url": "https://www.ifao.egnet.net/",
        "tags": ["excavation", "publications", "abydos"],
        "why": "Institut français d'archéologie orientale publications & fieldwork.",
    },
    {
        "id": "oeaw_egypt",
        "title": "Austrian Academy — Egypt / Sudan",
        "url": "https://www.oeaw.ac.at/en/egyptology",
        "tags": ["excavation", "abydos", "publications"],
        "why": "Academy Egyptology projects and publications.",
    },
    {
        "id": "bm_collection",
        "title": "British Museum Collection",
        "url": "https://www.britishmuseum.org/collection",
        "tags": ["museum", "objects", "abydos", "heliopolis", "giza"],
        "why": "Museum catalogue with provenanced Egyptian objects.",
    },
    {
        "id": "met_egypt",
        "title": "Met Museum — Egyptian Art",
        "url": "https://www.metmuseum.org/about-the-met/collection-areas/egyptian-art",
        "tags": ["museum", "objects", "abydos", "heliopolis", "giza"],
        "why": "Open Met Collection API-backed Egyptian holdings.",
    },
    {
        "id": "artic",
        "title": "Art Institute of Chicago — collection",
        "url": "https://www.artic.edu/collection",
        "tags": ["museum", "objects"],
        "why": "Open ARTIC API Egyptian / Near Eastern holdings.",
    },
    {
        "id": "trismegistos",
        "title": "Trismegistos",
        "url": "https://www.trismegistos.org/",
        "tags": ["texts", "places", "papyri", "bibliography"],
        "why": "Cross-linked places, texts, and bibliographic IDs for Egypt.",
    },
    {
        "id": "papyri_info",
        "title": "Papyri.info / idp.data",
        "url": "https://papyri.info/",
        "tags": ["texts", "papyri", "ddbdp", "abydos", "giza"],
        "why": "Aggregated documentary papyri editions (DDbDP/HGV/APIS/DCLP); open dump at github.com/papyri/idp.data.",
    },
    {
        "id": "oraec",
        "title": "ORAEC — Open Ras Egyptian Corpus",
        "url": "https://github.com/oraec/corpus_raw_data",
        "tags": ["texts", "inscriptions", "abydos", "osireion", "primary"],
        "why": "Open Egyptian inscription corpus with translations + bibliography (cc-by-sa).",
    },
    {
        "id": "open_context",
        "title": "Open Context",
        "url": "https://opencontext.org/",
        "tags": ["excavation", "archive", "giza", "abydos", "archaeology"],
        "why": "Published archaeological datasets and excavation archives (JSON API).",
    },
    {
        "id": "dza",
        "title": "Digitalisiertes Zettelarchiv (DZA) / AAeW",
        "url": "https://aaew.bbaw.de/tla/",
        "tags": ["texts", "dictionary", "tla"],
        "why": "Historical AAeW / TLA-related lexical resources.",
    },
    {
        "id": "griffith_archive",
        "title": "Griffith Institute Archive",
        "url": "http://www.griffith.ox.ac.uk/gri/4.html",
        "tags": ["archive", "facsimile", "abydos", "giza"],
        "why": "Griffith Institute archival holdings and digital resources.",
    },
    {
        "id": "orient_institute_chicago",
        "title": "ISAC / Oriental Institute publications",
        "url": "https://isac.uchicago.edu/research/publications/oriental-institute-publications",
        "tags": ["publications", "excavation", "abydos", "giza"],
        "why": "Open Oriental Institute excavation series (often Archive.org mirrors).",
    },
    {
        "id": "egyptologyforum_resources",
        "title": "Online Egyptological Bibliography (OEB)",
        "url": "https://oeb.griffith.ox.ac.uk/",
        "tags": ["bibliography", "literature"],
        "why": "Annual Egyptological bibliography (Griffith).",
    },
]


def _probe(url: str) -> Tuple[bool, str]:
    try:
        polite_sleep(0.25)
        raw = http_get(url, timeout=20.0, accept="text/html,*/*")
        ok = bool(raw) and len(raw) > 200
        return ok, f"reachable:{len(raw)}b" if ok else "empty"
    except Exception as exc:
        return False, str(exc)[:120]


def _ddg_links(query: str, *, limit: int = 8) -> List[Tuple[str, str]]:
    """Best-effort DuckDuckGo HTML results (title, url)."""
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    try:
        html = http_get(url, timeout=25.0, accept="text/html").decode("utf-8", errors="replace")
    except Exception:
        return []
    out: List[Tuple[str, str]] = []
    for m in re.finditer(
        r'class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        html,
        flags=re.I | re.S,
    ):
        href = m.group(1)
        title = re.sub(r"<[^>]+>", " ", m.group(2))
        title = re.sub(r"\s+", " ", title).strip()
        # DDG wraps redirects
        if "uddg=" in href:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            href = (qs.get("uddg") or [href])[0]
        href = urllib.parse.unquote(href)
        if not href.startswith("http"):
            continue
        host = urlparse(href).netloc.lower()
        if "duckduckgo.com" in host:
            continue
        out.append((title or host, href))
        if len(out) >= limit:
            break
    return out


def _seed_matches(site: Optional[Dict[str, Any]], query: str) -> List[Dict[str, Any]]:
    site_id = str((site or {}).get("id") or "")
    aliases = [site_id] + [str(a).lower() for a in ((site or {}).get("aliases") or [])]
    q = (query or "").lower()
    hits = []
    for seed in SEED_CATALOG:
        tags = [str(t).lower() for t in (seed.get("tags") or [])]
        score = 0
        if site_id and site_id in tags:
            score += 3
        if any(a and a in tags for a in aliases if a and a != "on"):
            score += 2
        if any(tok and tok in " ".join(tags) for tok in re.findall(r"[a-z]{4,}", q)):
            score += 1
        # Always keep core bibliography/text hubs
        if seed["id"] in ("topbib", "tla", "archive_org", "trismegistos", "oeb" if False else "egyptologyforum_resources"):
            score = max(score, 2)
        if score > 0 or not site:
            hits.append((score, seed))
    hits.sort(key=lambda x: (-x[0], x[1]["id"]))
    return [h[1] for h in hits]


def search(
    *,
    site: Optional[Dict[str, Any]],
    limit: int = 15,
    query: str = "",
    errors: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    errors = errors if errors is not None else []
    out: List[Dict[str, Any]] = []
    seen_hosts: set = set()
    site_id = (site or {}).get("id")
    packs = query_pack_for_site(site, query or "Egyptian archaeology digital archive")

    # 1) Curated seeds (probed)
    for seed in _seed_matches(site, query):
        if len(out) >= limit:
            break
        host = urlparse(seed["url"]).netloc.lower()
        if host in seen_hosts:
            continue
        ok, note = _probe(seed["url"])
        seen_hosts.add(host)
        official = "\n".join(
            x
            for x in (
                seed["title"],
                seed.get("why") or "",
                f"URL: {seed['url']}",
                f"Probe: {'ok' if ok else 'failed'} ({note})",
                f"Tags: {', '.join(seed.get('tags') or [])}",
                "Role: candidate digital archive / bibliography (source scout).",
            )
            if x
        )
        out.append(
            {
                "source": CONNECTOR_ID,
                "source_id": f"seed:{seed['id']}",
                "source_url": seed["url"],
                "title": seed["title"],
                "culture": "egyptian",
                "official_text": official,
                "image_url": "",
                "site": site_id,
                "period": "",
                "license": "See destination site terms",
                "connector": CONNECTOR_ID,
                "is_stub": False,
                "allow_without_image": True,
                "meta_extra": {
                    "kind": "source_candidate",
                    "literature_role": "discovery",
                    "reachable": ok,
                    "seed_id": seed["id"],
                    "discovery": "curated_seed",
                },
            }
        )

    # 2) Live web search for additional hubs
    search_qs = []
    if site:
        label = str(site.get("label") or site_id)
        search_qs.append(f"{label} Egyptology digital archive OR bibliography OR corpus")
        search_qs.append(f"{label} hieroglyph database OR excavation report online")
    for q in packs[:2]:
        search_qs.append(f"{q} Egyptology open digital library OR TopBib OR TLA")
    search_qs.append("Egyptian hieroglyph digital corpus archive bibliography open access")

    for q in search_qs:
        if len(out) >= limit:
            break
        polite_sleep(0.5)
        try:
            links = _ddg_links(q, limit=6)
        except Exception as exc:
            errors.append(f"source_scout_ddg:{q}:{exc}")
            continue
        if not links:
            errors.append(f"source_scout_ddg_empty:{q}")
            continue
        for title, href in links:
            if len(out) >= limit:
                break
            host = urlparse(href).netloc.lower()
            if not host or host in seen_hosts:
                continue
            # Prefer scholarly / archive-ish hosts
            blob = f"{title} {href} {q}".lower()
            if site and not text_matches_site(blob, site):
                # keep general egyptology hubs even without site alias
                if not any(
                    k in blob
                    for k in (
                        "egypt",
                        "hieroglyph",
                        "pharaoh",
                        "giza",
                        "abydos",
                        "heliopolis",
                        "papyrus",
                        "topbib",
                        "thesaurus",
                        "archive.org",
                    )
                ):
                    continue
            seen_hosts.add(host)
            ok, note = _probe(href)
            out.append(
                {
                    "source": CONNECTOR_ID,
                    "source_id": f"web:{host}:{abs(hash(href)) % 10_000_000}",
                    "source_url": href,
                    "title": title[:200],
                    "culture": "egyptian",
                    "official_text": (
                        f"{title}\nURL: {href}\nProbe: {'ok' if ok else 'failed'} ({note})\n"
                        f"Discovered via web search: {q}\n"
                        "Role: candidate digital archive / bibliography (source scout)."
                    ),
                    "image_url": "",
                    "site": site_id,
                    "period": "",
                    "license": "See destination site terms",
                    "connector": CONNECTOR_ID,
                    "is_stub": False,
                    "allow_without_image": True,
                    "meta_extra": {
                        "kind": "source_candidate",
                        "literature_role": "discovery",
                        "reachable": ok,
                        "discovery": "web_search",
                        "query": q,
                    },
                }
            )
    return out[:limit]
