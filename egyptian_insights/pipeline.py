"""Scribe → Scholar handshake pipeline."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import db
from . import harvest as harvest_mod
from . import research_goal
from . import scribe as scribe_mod
from . import scholar as scholar_mod


def run_pipeline(input_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = input_data or {}
    steps: List[Dict[str, Any]] = []
    harvest_ids: List[int] = []

    do_scrape = bool(data.get("scrape", True))
    if data.get("harvest_id"):
        harvest_ids = [int(data["harvest_id"])]
        do_scrape = False
    elif data.get("harvest_ids"):
        harvest_ids = [int(x) for x in data["harvest_ids"]]
        do_scrape = False

    if do_scrape:
        focus = data.get("focus") or data.get("site")
        scraped = harvest_mod.run_harvest(
            {
                "limit": data.get("limit", research_goal.load_goal().get("default_harvest_limit") or 15),
                "query": data.get("query") or research_goal.default_query(focus),
                "focus": focus,
                "note": data.get("note") or data.get("brief"),
                "allow_stubs": bool(data.get("allow_stubs")),
                "require_image": data.get("require_image", True),
                "sources": data.get("sources"),
            }
        )
        steps.append({"step": "scrape", "result": scraped})
        harvest_ids = [int(i["harvest_id"]) for i in (scraped.get("items") or []) if i.get("harvest_id")]

    transcribe = bool(data.get("transcribe", True))
    critique = bool(data.get("critique", True))
    only_with_images = bool(data.get("only_with_images", True))

    conn = db.connect()
    results = []
    for hid in harvest_ids:
        item = db.get_harvest(conn, hid) or {}
        entry: Dict[str, Any] = {"harvest_id": hid, "title": item.get("title")}
        if only_with_images and not item.get("image_path"):
            entry["skipped"] = "no_image"
            results.append(entry)
            continue
        if transcribe:
            tr = scribe_mod.transcribe_harvest(hid, model=data.get("scribe_model"))
            entry["transcription"] = tr
            steps.append({"step": "scribe", "harvest_id": hid, "ok": bool(tr.get("ok"))})
            if not tr.get("ok"):
                results.append(entry)
                continue
        if critique:
            cr = scholar_mod.critique_harvest(hid, model=data.get("scholar_model"))
            entry["critique"] = {
                "ok": cr.get("ok"),
                "critique_id": cr.get("critique_id"),
                "model": cr.get("model"),
                "preview": (cr.get("review_markdown") or "")[:600],
                "error": cr.get("error"),
            }
            steps.append({"step": "scholar", "harvest_id": hid, "ok": bool(cr.get("ok"))})
        results.append(entry)
    stats = db.stats(conn)
    conn.close()
    ok = any(r.get("transcription", {}).get("ok") or r.get("critique", {}).get("ok") for r in results) or bool(harvest_ids)
    return {"ok": ok, "harvest_ids": harvest_ids, "results": results, "steps": steps, "stats": stats}
