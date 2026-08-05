# EI literature connectors — enacted 20260805

Wired Tier-A Egyptology sources into the culture harvest path only
(`egyptian_insights` + EI tool belt). AusMaker untouched.

## Connectors

| ID | Upstream | How it finds material |
|---|---|---|
| `tla` | Thesaurus Linguae Aegyptiae (existing) | Public HTML object search (+ `chase_tla` tool) |
| `oraec` | oraec/corpus_raw_data (+ scraped_data catalog) | Cached hierarchical path index → `oraecN.json` |
| `papyri` | papyri/idp.data (Navigator not vendored) | GitHub code search when token present; curated dump paths otherwise; optional `PIKO_EI_PAPYRI_IDP_DIR` |
| `open_context` | opencontext.org JSON API | `query/.json?response=uri-meta` |
| `trismegistos` | christiancasey/trismegistos `Text Data.csv` → TM pages | Open Demotic index dump (no live TM HTML scrape) |

## Tools (ei-worker)
`seek_oraec`, `seek_papyri`, `seek_open_context`, `seek_trismegistos`, `chase_tla`
(plus existing `chase_topbib` / `seek_files` / `ingest_url`).

## Live evidence (adapter container)
```
connectors ['open_context', 'oraec', 'papyri', 'tla', 'trismegistos']
oc 1 Color Photo 022412
oraec 1 Das Buch Pehui-Kat …
tm 1 TM 100024 — Egypt
papyri 1 APIS/michigan/… (curated/auth path)
```

## Releases
| Target | Release / action |
|---|---|
| legion-adapter-customer-03 | rebuilt with new `egyptian_insights` sources |
| staging | `20260805-1533-f9495a3c` |
| customer-03 | `20260805-1536-f9495a3c` |

Not deployed to customer-01 / customer-04.

## Operator notes
- Set `GITHUB_TOKEN` / `GH_TOKEN` on the adapter host for full papyri/idp.data content search (GitHub requires auth). Compose already forwards these env vars.
- Optional local dump: `PIKO_EI_PAPYRI_IDP_DIR=/path/to/idp.data`.
- Optional TM CSV override: `PIKO_EI_TM_CSV=/path/to/Text Data.csv`.
