"""Probe + fetch_document connector (network mocked)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

SEED = "https://books.example.edu/reader/text?doc=Work.1"
DLTEXT = "https://books.example.edu/reader/dltext?doc=Work.1"
INDEX_HTML = f"""
<html><head><title>Herodotus, The Histories, Book 1, chapter 1</title></head>
<body>
<a href="/reader/home">Home</a>
<a href="/reader/xmltoc?doc=Work.1">XML TOC</a>
<a href="{DLTEXT}">Download XML text</a>
<a href="/reader/text?doc=Work.1:book=1:chapter=1">Ch 1</a>
<a href="/reader/text?doc=Work.1:book=1:chapter=2">Ch 2</a>
</body></html>
"""
TEI_XML = """<?xml version="1.0" encoding="utf-8"?>
<TEI.2>
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>The Histories</title>
        <author>Herodotus</author>
      </titleStmt>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div type="textpart" n="1"><p>This is the display of the inquiry of Herodotus of Halicarnassus,
      so that things done by man not be forgotten in time, and that great and marvelous deeds
      some displayed by the Hellenes some by the barbarians not lose their glory including
      among others what was the cause of their waging war on each other. Croesus was Lydian
      by birth and tyrant of all the nations west of the river Halys.</p></div>
      <div type="textpart" n="2"><p>The priests of Egypt told me that Min was the first king of Egypt
      and that in his time all Egypt except the Thebaic district was a marsh. Book two continues
      with the customs of the Egyptians and the Nile flood and the labours of the pyramid builders
      and the sacred animals and the oracles and the festivals of Dionysus.</p></div>
    </body>
  </text>
</TEI.2>
"""
# Pad TEI so it clears MIN_DOCUMENT_CHARS
TEI_XML = TEI_XML.replace(
    "the festivals of Dionysus.",
    "the festivals of Dionysus. " + ("The Nile rises in summer. " * 200),
)

SACRED_HTML = """
<html><head><title>Pyramid Texts Index</title></head>
<body>
<a href="pyt01.htm">Utterances 1-20</a>
<a href="pyt02.htm">Utterances 21-40</a>
<a href="pyt03.htm">Utterances 41-60</a>
<a href="pyt04.htm">Utterances 61-80</a>
<a href="pyt05.htm">Utterances 81-100</a>
</body></html>
"""


class PageProbeTests(unittest.TestCase):
    def test_extract_download_prefers_pdf_over_ia_marc_xml(self):
        from egyptian_insights.sources import page_probe

        html = """
        <html><head><title>Die altaegyptischen Pyramidentexte</title></head>
        <body>
        <a href="/download/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft_archive_marc.xml">MARC XML</a>
        <a href="/download/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft.pdf">PDF</a>
        <a href="/download/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft_meta.xml">Meta XML</a>
        </body></html>
        """
        base = "https://archive.org/details/diealtaegyptisch03sethuoft"
        links = page_probe.extract_download_links(html, base)
        urls = [d["url"] for d in links]
        self.assertTrue(any(u.endswith(".pdf") for u in urls), urls)
        self.assertFalse(any("archive_marc" in u or "_meta.xml" in u for u in urls), urls)
        self.assertEqual(links[0]["hint"], "pdf")
        self.assertTrue(links[0]["url"].endswith(".pdf"))

    def test_extract_download_prefers_ia_djvu_txt_over_pdf(self):
        from egyptian_insights.sources import page_probe

        html = """
        <html><head><title>Die altaegyptischen Pyramidentexte</title></head>
        <body>
        <a href="/download/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft.pdf">PDF</a>
        <a href="/stream/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft_djvu.txt">Full text</a>
        <a href="/download/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft_archive_marc.xml">MARC</a>
        </body></html>
        """
        base = "https://archive.org/details/diealtaegyptisch03sethuoft"
        links = page_probe.extract_download_links(html, base)
        self.assertEqual(links[0]["hint"], "txt")
        self.assertTrue(links[0]["url"].endswith("_djvu.txt"), links[0]["url"])

    def test_extract_download_prefers_dltext_over_xmltoc(self):
        from egyptian_insights.sources import page_probe

        links = page_probe.extract_download_links(INDEX_HTML, SEED)
        urls = [d["url"] for d in links]
        self.assertIn(DLTEXT, urls)
        self.assertFalse(any("xmltoc" in u for u in urls))
        self.assertEqual(links[0]["url"], DLTEXT)

    def test_probe_html_with_download(self):
        from egyptian_insights.sources import page_probe

        def fake_fetch(url, **kwargs):
            if url == SEED:
                return "text/html; charset=utf-8", INDEX_HTML.encode("utf-8")
            raise AssertionError(url)

        with mock.patch.object(page_probe, "fetch_bytes", side_effect=fake_fetch):
            card = page_probe.probe_url(SEED)
        self.assertEqual(card["kind"], "html_with_download")
        self.assertEqual(card["preferred_fetch_url"], DLTEXT)
        self.assertEqual(page_probe.choose_connector(card), "web_document")

    def test_probe_direct_tei(self):
        from egyptian_insights.sources import page_probe

        with mock.patch.object(
            page_probe, "fetch_bytes", return_value=("text/xml; charset=utf-8", TEI_XML.encode("utf-8")),
        ):
            card = page_probe.probe_url(DLTEXT)
        self.assertEqual(card["kind"], "xml_document")
        self.assertEqual(page_probe.choose_connector(card), "web_document")

    def test_probe_sacred_texts_style_toc_routes_to_web_text(self):
        from egyptian_insights.sources import page_probe

        with mock.patch.object(
            page_probe,
            "fetch_bytes",
            return_value=("text/html; charset=utf-8", SACRED_HTML.encode("utf-8")),
        ):
            card = page_probe.probe_url("https://sacred-texts.com/egy/pyt/")
        self.assertEqual(card["kind"], "html_book_toc")
        self.assertEqual(page_probe.choose_connector(card), "web_text")

    def test_should_auto_route(self):
        from egyptian_insights.sources.page_probe import should_auto_route

        self.assertTrue(should_auto_route(["web_pdf", "web_text"]))
        self.assertTrue(should_auto_route(["web_pdf", "web_document", "web_text"]))
        self.assertFalse(should_auto_route(["web_text"]))
        self.assertFalse(should_auto_route(["web_pdf", "web_text"], auto_route=False))


class WebDocumentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["EGYPTIAN_INSIGHTS_DATA_DIR"] = self.tmp.name
        from egyptian_insights.sources import web_document

        self.web_document = web_document

    def tearDown(self):
        self.tmp.cleanup()

    def test_tei_extract_title_and_body(self):
        text = self.web_document.xml_document_to_text(TEI_XML)
        self.assertIn("inquiry of Herodotus", text)
        self.assertIn("priests of Egypt", text)
        self.assertNotIn("teiHeader", text)
        title = self.web_document.title_from_xml(TEI_XML)
        self.assertIn("Histories", title)
        self.assertIn("Herodotus", title)

    def test_search_fetches_dltext_not_chapter_bfs(self):
        from egyptian_insights.sources import page_probe

        fetched = []

        def fake_fetch(url, **kwargs):
            fetched.append(url)
            if url == SEED:
                return "text/html; charset=utf-8", INDEX_HTML.encode("utf-8")
            if url == DLTEXT:
                return "text/xml; charset=utf-8", TEI_XML.encode("utf-8")
            raise AssertionError(f"unexpected fetch {url}")

        with mock.patch.object(page_probe, "fetch_bytes", side_effect=fake_fetch):
            errors: list = []
            rows = self.web_document.search(
                site=None,
                limit=3,
                query=f"SEED_URL:{SEED}",
                errors=errors,
            )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["source"], "web_document")
        self.assertEqual(row["source_url"], SEED)
        self.assertFalse(row["is_stub"])
        self.assertEqual(row["meta_extra"]["literature_role"], "web_document")
        self.assertTrue(row["meta_extra"]["is_full_document"])
        self.assertGreater(row["meta_extra"]["text_chars_total"], 3000)
        doc = Path(row["document_local_path"])
        self.assertTrue(doc.exists())
        body = doc.read_text(encoding="utf-8")
        self.assertIn("inquiry of Herodotus", body)
        self.assertIn(DLTEXT, fetched)
        self.assertTrue(any(e.startswith("web_document_ok:") for e in errors))

    def test_harvest_auto_route_uses_web_document(self):
        from egyptian_insights import harvest
        from egyptian_insights.sources import page_probe, registry

        card = {
            "kind": "html_with_download",
            "preferred_fetch_url": DLTEXT,
            "preferred_hint": "tei_xml",
            "title": "The Histories",
            "error": None,
        }
        dest = Path(self.tmp.name) / "assets" / "documents"
        dest.mkdir(parents=True, exist_ok=True)
        doc = dest / "webdoc_test.txt"
        doc.write_text("inquiry of Herodotus " * 400, encoding="utf-8")
        fake_row = {
            "source": "web_document",
            "source_id": "webdoc_test",
            "source_url": SEED,
            "title": "Herodotus, The Histories",
            "official_text": "inquiry of Herodotus " * 200,
            "document_local_path": str(doc),
            "document_ext": ".txt",
            "allow_without_image": True,
            "is_stub": False,
            "meta_extra": {
                "kind": "literature",
                "literature_role": "web_document",
                "text_chars_total": 8000,
                "is_full_document": True,
            },
        }
        called = {"web_document": 0, "web_text": 0, "web_pdf": 0}

        def doc_search(**kwargs):
            called["web_document"] += 1
            return [fake_row]

        def text_search(**kwargs):
            called["web_text"] += 1
            return []

        def pdf_search(**kwargs):
            called["web_pdf"] += 1
            return []

        with mock.patch.object(page_probe, "probe_url", return_value=card), \
             mock.patch.dict(registry.CONNECTORS, {
                 "web_document": doc_search,
                 "web_text": text_search,
                 "web_pdf": pdf_search,
             }, clear=False):
            out = harvest.run_harvest({
                "query": f"SEED_URL:{SEED}",
                "sources": ["web_pdf", "web_text"],
                "require_image": False,
                "require_document": True,
                "skip_thin": True,
                "allow_stubs": False,
                "limit": 3,
                "auto_route": True,
            })
        self.assertEqual(called["web_document"], 1)
        self.assertEqual(called["web_text"], 0)
        self.assertEqual(called["web_pdf"], 0)
        self.assertEqual(out.get("ingest_route", {}).get("connector"), "web_document")
        self.assertTrue(any(str(e).startswith("ingest_route:web_document:") for e in (out.get("errors") or [])))
        self.assertGreaterEqual(out.get("live_count") or 0, 1)
        self.assertTrue(out.get("ok"))

    def test_replace_incomplete_web_text_with_document(self):
        from egyptian_insights import db, harvest

        conn = db.connect()
        stub_meta = {
            "kind": "literature",
            "literature_role": "web_text",
            "is_stub": True,
            "pages_scraped": 10,
            "crawl_qa": {"ok": False, "reason": "crawl_truncated"},
            "document_path": str(Path(self.tmp.name) / "old.txt"),
        }
        hid = db.upsert_harvest(conn, {
            "source": "web_text",
            "source_id": "webtext_old",
            "source_url": SEED,
            "title": "Herodotus, The Histories, Book 1, chapter 1",
            "culture": "egyptian",
            "official_text": "chrome stub",
            "meta_json": __import__("json").dumps(stub_meta),
        })
        dest = Path(self.tmp.name) / "assets" / "documents"
        dest.mkdir(parents=True, exist_ok=True)
        new_doc = dest / "webdoc_new.txt"
        new_doc.write_text("inquiry of Herodotus " * 400, encoding="utf-8")
        saved = harvest._persist_item(
            conn,
            {
                "source": "web_document",
                "source_id": "webdoc_new",
                "source_url": SEED,
                "title": "Herodotus, The Histories",
                "official_text": "inquiry of Herodotus " * 200,
                "document_local_path": str(new_doc),
                "document_ext": ".txt",
                "allow_without_image": True,
                "is_stub": False,
                "meta_extra": {
                    "kind": "literature",
                    "literature_role": "web_document",
                    "text_chars_total": 9000,
                    "is_full_document": True,
                    "document_format": "tei_xml",
                },
            },
            focus=None,
            query=f"SEED_URL:{SEED}",
            require_image=False,
            require_document=True,
            force_recrawl=True,
            errors=[],
        )
        conn.close()
        self.assertIsNotNone(saved)
        self.assertEqual(saved["harvest_id"], hid)
        self.assertEqual(saved["source"], "web_document")
        self.assertFalse(saved["is_stub"])
        conn = db.connect()
        row = dict(conn.execute("SELECT source, source_id, title, meta_json FROM harvest_items WHERE id=?", (hid,)).fetchone())
        conn.close()
        meta = __import__("json").loads(row["meta_json"])
        self.assertEqual(row["source"], "web_document")
        self.assertEqual(meta.get("literature_role"), "web_document")
        self.assertTrue(meta.get("is_full_document"))
        self.assertFalse(meta.get("is_stub"))


if __name__ == "__main__":
    unittest.main()
