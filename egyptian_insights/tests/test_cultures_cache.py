"""Unit tests for cultures cache + harvest (mocked connectors when offline)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


class CulturesCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["EGYPTIAN_INSIGHTS_DATA_DIR"] = self.tmp.name
        from egyptian_insights import db, harvest

        self.db = db
        self.harvest = harvest

    def tearDown(self):
        self.tmp.cleanup()

    def test_schema_and_upsert(self):
        conn = self.db.connect()
        hid = self.db.upsert_harvest(
            conn,
            {
                "source": "test",
                "source_id": "a1",
                "title": "Test stela",
                "official_text": "hello",
                "image_path": None,
            },
        )
        self.assertGreater(hid, 0)
        hid2 = self.db.upsert_harvest(
            conn,
            {"source": "test", "source_id": "a1", "title": "Test stela updated", "official_text": "hello2"},
        )
        self.assertEqual(hid, hid2)
        st = self.db.stats(conn)
        self.assertEqual(st["harvest_items"], 1)
        conn.close()

    def test_title_normalize_and_match(self):
        self.assertEqual(
            self.db.normalize_title("PDF The Temple of Ehnasya.pdf"),
            "temple of ehnasya",
        )
        self.assertTrue(
            self.db.titles_match(
                "Tanis Part II — Nebesheh and Defenneh",
                "Tanis Part II: Nebesheh and Defenneh (PDF)",
            )
        )
        self.assertFalse(self.db.titles_match("Tanis", "Hawara"))

    def test_upsert_replace_preserves_pm_confirmed_thread(self):
        conn = self.db.connect()
        hid = self.db.upsert_harvest(
            conn,
            {
                "source": "web_document",
                "source_id": "sethe-pt",
                "title": "Die altaegyptischen Pyramidentexte",
                "source_url": "https://archive.org/stream/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft_djvu.txt",
                "official_text": "utterance " * 80,
                "meta_json": json.dumps(
                    {"thread": "self-view", "site": "self-view", "pm_confirmed": True, "pm_confirm_id": "rpc_1"},
                    ensure_ascii=False,
                ),
            },
        )
        hid2 = self.db.upsert_harvest(
            conn,
            {
                "source": "web_document",
                "source_id": "sethe-pt",
                "title": "Die altaegyptischen Pyramidentexte",
                "source_url": "https://archive.org/stream/diealtaegyptisch03sethuoft/diealtaegyptisch03sethuoft_djvu.txt",
                "official_text": "utterance " * 120,
                "meta_json": json.dumps({"thread": "giza", "site": "giza"}, ensure_ascii=False),
            },
            replace=True,
        )
        self.assertEqual(hid, hid2)
        row = self.db.get_harvest(conn, hid)
        meta = json.loads(row["meta_json"] or "{}")
        self.assertEqual(meta.get("thread"), "self-view")
        self.assertEqual(meta.get("site"), "self-view")
        self.assertTrue(meta.get("pm_confirmed"))
        conn.close()

    def test_upsert_on_conflict_preserves_pm_confirmed_thread(self):
        conn = self.db.connect()
        hid = self.db.upsert_harvest(
            conn,
            {
                "source": "web_document",
                "source_id": "amarna-knud",
                "title": "Die El-Amarna-Tafeln",
                "source_url": "https://archive.org/details/dieelamarnatafel01knud",
                "official_text": "tablet " * 80,
                "meta_json": json.dumps(
                    {"thread": "self-view", "site": "self-view", "pm_confirmed": True},
                    ensure_ascii=False,
                ),
            },
        )
        hid2 = self.db.upsert_harvest(
            conn,
            {
                "source": "web_document",
                "source_id": "amarna-knud",
                "title": "Die El-Amarna-Tafeln recrawl",
                "source_url": "https://archive.org/details/dieelamarnatafel01knud",
                "official_text": "tablet " * 120,
                "meta_json": json.dumps({"thread": "giza", "site": "giza"}, ensure_ascii=False),
            },
        )
        self.assertEqual(hid, hid2)
        row = self.db.get_harvest(conn, hid)
        meta = json.loads(row["meta_json"] or "{}")
        self.assertEqual(meta.get("thread"), "self-view")
        self.assertTrue(meta.get("pm_confirmed"))
        conn.close()

    def test_upsert_dedupes_by_title_across_sources(self):
        conn = self.db.connect()
        hid = self.db.upsert_harvest(
            conn,
            {
                "source": "archive_org",
                "source_id": "tanispartiinebes00petruoft",
                "title": "Tanis Part II Nebesheh and Defenneh",
                "source_url": "https://archive.org/details/tanispartiinebes00petruoft",
                "official_text": "first",
                "meta_json": json.dumps(
                    {"kind": "literature", "document_path": "/tmp/a.pdf"},
                    ensure_ascii=False,
                ),
            },
        )
        hid2 = self.db.upsert_harvest(
            conn,
            {
                "source": "web_pdf",
                "source_id": "abc123",
                "title": "Tanis Part II — Nebesheh and Defenneh.pdf",
                "source_url": "https://example.test/tanis.pdf",
                "official_text": "second shorter",
                "meta_json": json.dumps({"kind": "literature"}, ensure_ascii=False),
            },
        )
        self.assertEqual(hid, hid2)
        st = self.db.stats(conn)
        self.assertEqual(st["harvest_items"], 1)
        row = self.db.get_harvest(conn, hid)
        meta = json.loads(row["meta_json"] or "{}")
        self.assertEqual(len(meta.get("title_aliases") or []), 1)
        self.assertEqual(meta["title_aliases"][0]["source"], "web_pdf")
        conn.close()

    def test_harvest_fails_without_live_when_stubs_disallowed(self):
        def fake_run_connectors(**kwargs):
            return {"items": [], "errors": ["all_failed"], "connector_stats": {"met": 0}}

        with mock.patch("egyptian_insights.harvest.run_connectors", side_effect=fake_run_connectors):
            out = self.harvest.run_harvest({"limit": 2, "focus": "abydos", "allow_stubs": False})
        self.assertFalse(out.get("ok"))
        self.assertEqual(out.get("live_count"), 0)

    def test_harvest_persists_live_connector_rows(self):
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
            b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        # Pad to >10KB so MIN_IMAGE_BYTES passes
        big = png + (b"\x00" * 12000)

        def fake_run_connectors(**kwargs):
            return {
                "items": [
                    {
                        "source": "met",
                        "source_id": "999001",
                        "source_url": "https://example.test/obj/999001",
                        "title": "Abydos test relief",
                        "culture": "egyptian",
                        "official_text": "Test official text for Abydos",
                        "image_url": "https://example.test/img.jpg",
                        "site": "abydos",
                        "period": "Early Dynastic",
                        "license": "Public Domain",
                        "connector": "met",
                        "is_stub": False,
                    }
                ],
                "errors": [],
                "connector_stats": {"met": 1},
            }

        with mock.patch("egyptian_insights.harvest.run_connectors", side_effect=fake_run_connectors):
            with mock.patch("egyptian_insights.harvest.download_bytes", return_value=big):
                out = self.harvest.run_harvest({"limit": 1, "focus": "abydos", "allow_stubs": False})
        self.assertTrue(out.get("ok"), out)
        self.assertEqual(out.get("live_count"), 1)
        self.assertEqual(out.get("focus"), "abydos")
        self.assertEqual(out["items"][0]["source"], "met")
        meta = json.loads(
            self.db.connect().execute("SELECT meta_json FROM harvest_items WHERE source_id='999001'").fetchone()[0]
        )
        self.assertEqual(meta.get("site"), "abydos")
        self.assertFalse(meta.get("is_stub"))

    def test_literature_persists_without_image(self):
        def fake_run_connectors(**kwargs):
            return {
                "items": [
                    {
                        "source": "archive_org",
                        "source_id": "abydos1petr",
                        "source_url": "https://archive.org/details/abydos1petr",
                        "title": "Abydos",
                        "culture": "egyptian",
                        "official_text": "Petrie excavation report OCR sample mentioning Umm el-Qa'ab.",
                        "image_url": "",
                        "document_url": "https://example.test/abydos1petr.pdf",
                        "document_ext": ".pdf",
                        "site": "abydos",
                        "connector": "archive_org",
                        "is_stub": False,
                        "allow_without_image": True,
                        "meta_extra": {"kind": "literature", "literature_role": "work"},
                    }
                ],
                "errors": [],
                "connector_stats": {"archive_org": 1},
            }

        pdf = b"%PDF-1.4 literature-smoke " + (b"x" * 800)
        with mock.patch("egyptian_insights.harvest.run_connectors", side_effect=fake_run_connectors):
            with mock.patch("egyptian_insights.harvest.download_document", return_value=pdf):
                out = self.harvest.run_harvest(
                    {
                        "limit": 1,
                        "focus": "abydos",
                        "allow_stubs": False,
                        "require_image": True,
                        "sources": ["archive_org"],
                    }
                )
        self.assertTrue(out.get("ok"), out)
        self.assertEqual(out.get("live_count"), 1)
        self.assertEqual(out["items"][0]["source"], "archive_org")
        self.assertEqual(out["items"][0].get("kind"), "literature")
        self.assertTrue(out["items"][0].get("document_path"))
        meta = json.loads(
            self.db.connect()
            .execute("SELECT meta_json FROM harvest_items WHERE source_id='abydos1petr'")
            .fetchone()[0]
        )
        self.assertEqual(meta.get("kind"), "literature")
        self.assertGreater(int(meta.get("document_bytes") or 0), 500)


if __name__ == "__main__":
    unittest.main()
