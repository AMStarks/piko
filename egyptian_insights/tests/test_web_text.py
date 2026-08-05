"""Unit tests for the web_text word-for-word site scraper (network mocked)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

INDEX_URL = "https://example.org/egy/pyt/index.htm"
INDEX_HTML = """
<html><head><title>The Pyramid Texts Index</title><style>.x{}</style></head>
<body><nav><a href="/home.htm">Home</a></nav>
<h1>The Pyramid Texts</h1>
<a href="pyt01.htm">Utterances 1-20</a>
<a href="pyt02.htm">Utterances 21-40</a>
<a href="pyt02.htm#frag">dupe with fragment</a>
<a href="../other/book.htm">Different book</a>
<a href="img/plate.jpg">Plate</a>
<a href="index.htm">Self link</a>
</body></html>
"""
PAGE1_HTML = """
<html><head><title>Utterances 1-20</title><script>var x=1;</script></head>
<body><p>Utterance 1.</p><p>To say the words: "The sky-god protects the king,
he lives beyond every boundary of &amp; the horizon."</p></body></html>
"""
PAGE2_HTML = """
<html><body><p>Utterance 21.</p><p>The king rises as Osiris rises; word for
word this text is preserved exactly as written on the walls of Unas.</p></body></html>
"""


def _fake_fetch(url: str):
    mapping = {
        INDEX_URL: INDEX_HTML,
        "https://example.org/egy/pyt/pyt01.htm": PAGE1_HTML,
        "https://example.org/egy/pyt/pyt02.htm": PAGE2_HTML,
    }
    if url in mapping:
        return "text/html; charset=utf-8", mapping[url]
    raise RuntimeError(f"unexpected fetch {url}")


class WebTextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["EGYPTIAN_INSIGHTS_DATA_DIR"] = self.tmp.name
        from egyptian_insights.sources import web_text

        self.web_text = web_text

    def tearDown(self):
        self.tmp.cleanup()

    def test_html_to_text_verbatim(self):
        text = self.web_text.html_to_text(PAGE1_HTML)
        self.assertIn("Utterance 1.", text)
        self.assertIn("he lives beyond every boundary of & the horizon.", text)
        self.assertNotIn("var x=1", text)
        self.assertNotIn("<p>", text)

    def test_collect_links_scope_and_order(self):
        links = self.web_text.collect_links(INDEX_HTML, INDEX_URL)
        self.assertEqual(links, [
            "https://example.org/egy/pyt/pyt01.htm",
            "https://example.org/egy/pyt/pyt02.htm",
        ])

    def test_crawl_and_search_writes_single_txt_document(self):
        with mock.patch.object(self.web_text, "_fetch", side_effect=_fake_fetch), \
             mock.patch.object(self.web_text, "probe_html", return_value=(True, "test")), \
             mock.patch.object(self.web_text, "PAGE_DELAY", 0.0):
            errors: list = []
            rows = self.web_text.search(
                site=None,
                limit=3,
                query=f"SEED_URL:{INDEX_URL}",
                errors=errors,
            )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["source"], "web_text")
        self.assertEqual(row["document_ext"], ".txt")
        self.assertEqual(row["title"], "The Pyramid Texts Index")
        doc = Path(row["document_local_path"])
        self.assertTrue(doc.exists())
        body = doc.read_text(encoding="utf-8")
        self.assertIn("Utterance 1.", body)
        self.assertIn("walls of Unas", body)
        # Page order preserved
        self.assertLess(body.index("Utterance 1."), body.index("Utterance 21."))
        meta = row["meta_extra"]
        self.assertEqual(meta["kind"], "literature")
        self.assertEqual(meta["pages_scraped"], 2)
        self.assertTrue(meta["verbatim"])
        self.assertTrue(any(e.startswith("web_text_ok:") for e in errors))

    def test_search_ignores_non_seed_queries(self):
        rows = self.web_text.search(site=None, limit=3, query="Pyramid Texts PDF", errors=[])
        self.assertEqual(rows, [])

    def test_web_pdf_seed_only_query_never_keyword_searches(self):
        from egyptian_insights.sources import web_pdf

        def _boom(*a, **k):
            raise AssertionError("keyword search must not run for seed-only queries")

        with mock.patch.object(web_pdf, "_probe_pdf", return_value=(False, "html")), \
             mock.patch.object(web_pdf, "_search_searxng", side_effect=_boom), \
             mock.patch.object(web_pdf, "_search_serper", side_effect=_boom):
            errors: list = []
            rows = web_pdf.search(
                site=None,
                limit=5,
                query=f"SEED_URL:{INDEX_URL}",
                errors=errors,
            )
        # HTML seed → gap rows only, no open-web search hits
        self.assertTrue(all(r["source_id"].startswith("gap_") for r in rows))
        self.assertIn("web_pdf_search_hits:0", errors)

    def test_persist_item_uses_local_document(self):
        from egyptian_insights import db, harvest

        doc = Path(self.tmp.name) / "book.txt"
        doc.write_text("word for word " * 100, encoding="utf-8")
        conn = db.connect()
        errors: list = []
        saved = harvest._persist_item(
            conn,
            {
                "source": "web_text",
                "source_id": "webtext_test_1",
                "source_url": INDEX_URL,
                "title": "The Pyramid Texts",
                "official_text": "word for word " * 60,
                "document_url": INDEX_URL,
                "document_ext": ".txt",
                "document_local_path": str(doc),
                "allow_without_image": True,
                "meta_extra": {"kind": "literature", "literature_role": "web_text"},
            },
            focus=None,
            query=f"SEED_URL:{INDEX_URL}",
            require_image=False,
            require_document=True,
            errors=errors,
        )
        conn.close()
        self.assertIsNotNone(saved)
        self.assertEqual(saved["document_path"], str(doc))
        self.assertGreater(saved["harvest_id"], 0)


if __name__ == "__main__":
    unittest.main()
