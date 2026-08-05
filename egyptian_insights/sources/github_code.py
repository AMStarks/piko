"""GitHub helpers for EI connectors (code search + raw file fetch).

Uses GITHUB_TOKEN / GH_TOKEN when present for higher rate limits.
Code search is the practical discovery path for idp.data / ORAEC dumps
when site front-doors are bot-gated (e.g. papyri.info Anubis).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from .base import USER_AGENT, polite_sleep

API = "https://api.github.com"


def _token() -> str:
    return (
        str(os.environ.get("GITHUB_TOKEN") or "").strip()
        or str(os.environ.get("GH_TOKEN") or "").strip()
        or str(os.environ.get("PIKO_GITHUB_TOKEN") or "").strip()
    )


def _headers(accept: str = "application/vnd.github+json") -> Dict[str, str]:
    h = {
        "User-Agent": USER_AGENT,
        "Accept": accept,
    }
    tok = _token()
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


def http_get_bytes(url: str, *, timeout: float = 45.0, accept: str = "*/*") -> bytes:
    req = urllib.request.Request(url, headers=_headers(accept=accept))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_json(url: str, *, timeout: float = 45.0) -> Any:
    raw = http_get_bytes(url, timeout=timeout, accept="application/vnd.github+json")
    return json.loads(raw.decode("utf-8", errors="replace"))


def code_search(query: str, *, repo: str, limit: int = 10, errors: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Search code in a public repo. Returns GitHub search items (path, html_url, …)."""
    errors = errors if errors is not None else []
    q = f"{query} repo:{repo}"
    params = urllib.parse.urlencode({"q": q, "per_page": max(1, min(30, limit))})
    url = f"{API}/search/code?{params}"
    polite_sleep(0.4)
    try:
        data = http_get_json(url, timeout=40.0)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:
            body = ""
        errors.append(f"github_code_search:{exc.code}:{body or exc.reason}")
        return []
    except Exception as exc:
        errors.append(f"github_code_search:{exc}")
        return []
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    return [it for it in items if isinstance(it, dict)][:limit]


def raw_url(repo: str, path: str, *, ref: str = "master") -> str:
    owner_repo = repo.strip()
    parts = [urllib.parse.quote(p) for p in path.lstrip("/").split("/") if p != ""]
    return f"https://raw.githubusercontent.com/{owner_repo}/{ref}/{'/'.join(parts)}"


def fetch_raw(repo: str, path: str, *, refs: Optional[List[str]] = None, timeout: float = 45.0) -> str:
    """Fetch a raw file, trying master then main (common default-branch split)."""
    tried = refs or ["master", "main"]
    last_err: Optional[Exception] = None
    for ref in tried:
        url = raw_url(repo, path, ref=ref)
        try:
            polite_sleep(0.15)
            return http_get_bytes(url, timeout=timeout, accept="*/*").decode("utf-8", errors="replace")
        except Exception as exc:
            last_err = exc
            continue
    if last_err:
        raise last_err
    raise RuntimeError(f"fetch_raw_failed:{repo}:{path}")
