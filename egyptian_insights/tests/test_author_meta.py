import unittest

from egyptian_insights.author_meta import enrich_meta, normalize_creator, authors_from_title


class AuthorMetaTests(unittest.TestCase):
    def test_normalize_creator(self):
        self.assertEqual(
            normalize_creator("Petrie, W. M. Flinders (William Matthew), 1853-1942"),
            "W. M. Flinders Petrie",
        )

    def test_title_byline(self):
        authors = authors_from_title("Tanis, Part II by W. M. Flinders Petrie")
        self.assertTrue(any("Petrie" in a for a in authors))

    def test_enrich_from_creator(self):
        meta, authors, changed = enrich_meta(
            {"kind": "literature", "creator": "Dunn, Christopher"},
            "The Giza Power Plant",
        )
        self.assertTrue(changed)
        self.assertEqual(meta["author"], "Christopher Dunn")
        self.assertIn("Christopher Dunn", authors)


if __name__ == "__main__":
    unittest.main()
