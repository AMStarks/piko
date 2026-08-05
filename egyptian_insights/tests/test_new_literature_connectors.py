"""Unit tests for ORAEC / Papyri / Open Context / Trismegistos connectors."""
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

from egyptian_insights.sources import open_context, oraec, papyri, registry, trismegistos  # noqa: E402


class RegistryTests(unittest.TestCase):
    def test_new_connectors_registered(self):
        for name in ("oraec", "papyri", "open_context", "trismegistos", "tla"):
            self.assertIn(name, registry.CONNECTORS)
            self.assertIn(name, registry.LITERATURE_CONNECTORS)


class OpenContextTests(unittest.TestCase):
    def test_search_maps_uri_meta(self):
        sample = [
            {
                "label": "Abydos trench photo",
                "href": "https://opencontext.org/media/abc",
                "project label": "ARCE",
                "context label": "Africa/Egypt/Abydos",
                "item category": "Image media",
                "snippet": "view of <mark>Abydos</mark>",
            }
        ]
        with mock.patch.object(open_context, "_query", return_value=sample):
            rows = open_context.search(site={"id": "abydos", "aliases": ["abydos"]}, limit=5, query="Abydos")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source"], "open_context")
        self.assertIn("Abydos", rows[0]["official_text"])


class OraecTests(unittest.TestCase):
    def test_path_index_match_and_json(self):
        index = [
            ("oraec12", "…Abydos?→pBM…"),
            ("oraec9006", "…Osireion…Abydos…"),
            ("oraec1", "Gebel Barkal→…"),
        ]
        hits = oraec._match_ids(index, "Abydos", limit=5)
        self.assertEqual([h[0] for h in hits], ["oraec12", "oraec9006"])

        payload = {
            "oraec12": {
                "oraecid": "oraec12",
                "title": "Salt 825 ritual",
                "origplace": [{"origplace": "Abydos"}],
                "date": [{"date": "Late Period"}],
                "bibliography": "PM V",
                "sentences": [{"translation": "A ritual text."}],
                "credits": {"license": "cc-by-sa-4.0"},
            }
        }
        row = oraec._record_from_json("oraec12", json.dumps(payload), path_hint="Abydos path")
        self.assertIsNotNone(row)
        self.assertEqual(row["source"], "oraec")
        self.assertIn("Abydos", row["official_text"])


class TrismegistosTests(unittest.TestCase):
    def test_csv_search_demotic_egypt(self):
        csv_text = (
            ",TM Number,Period,Date String,Uncertain,Date (Start),Date (End),Provenance,Language\n"
            "0,100024,Ptolemaic period,BC 332 - 30,False,-332,-30,Egypt,Demotic\n"
            "1,100028,Ptolemaic period,BC 332 - 30,False,-332,-30,Pathyris (Gebelein),Demotic\n"
            "2,200001,Roman,AD 100,False,100,100,Rome,Latin\n"
        )
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "tm.csv")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(csv_text)
            with mock.patch.dict(os.environ, {"PIKO_EI_TM_CSV": path}):
                rows = trismegistos.search(site=None, limit=5, query="Egypt")
        self.assertTrue(any(r["source_id"] == "100024" for r in rows))
        self.assertFalse(any(r["source_id"] == "200001" for r in rows))


class PapyriTests(unittest.TestCase):
    def test_xml_extract(self):
        xml = """<?xml version="1.0"?>
        <TEI xmlns="http://www.tei-c.org/ns/1.0">
          <teiHeader><title>Test papyrus</title></teiHeader>
          <origPlace>Abydos (Thinites, Egypt)</origPlace>
          <body><ab>Some documentary text about offerings.</ab></body>
        </TEI>
        """
        meta = papyri._xml_title_and_text(xml, "DCLP/1/1.xml")
        self.assertIn("Test papyrus", meta["title"])
        self.assertIn("Abydos", meta["place"])


if __name__ == "__main__":
    unittest.main()
