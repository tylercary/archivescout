# ArchiveScout marketplace adapter

A tiny standalone service that serves Grailed data in the **exact feed
shape ArchiveScout consumes**. It is the isolated boundary where a real data
source lives — the Next.js app never talks to a marketplace directly, it only
fetches this feed over HTTP. Swap the source here; the app never changes.

```
ArchiveScout (live mode)  ──HTTP──▶  this adapter  ──▶  data source
  GRAILED_API_BASE=…/grailed                            (grailed_api)
```

## Quick start — one command (from the repo root)

```bash
pip install grailed_api   # once
npm run dev:all           # boots the app (wired to this adapter) + the adapter
# open http://localhost:3000 and search — Grailed results come from the adapter
```

`dev:all` sets the app's `DATA_SOURCE=live` and the adapter URL for you, so
there's nothing else to configure.

## Run the adapter on its own

```bash
npm run adapter                        # from repo root (:8787)
# or:
cd services/marketplace-adapter && python3 adapter.py
```

To wire the app manually instead of `dev:all`, put this in the repo-root
`.env.local`, then `npm run dev`:

```bash
DATA_SOURCE=live
GRAILED_API_BASE=http://localhost:8787/grailed
GRAILED_API_KEY=local-dev-key
```

(With no `ADAPTER_API_KEY` set, the adapter accepts any non-empty bearer token,
so any `*_API_KEY` value works locally.)

`search_grailed_live()` calls `grailed_api`'s `find_products()` and maps each
product into the feed shape via `map_grailed_live()`. Grailed's backend field
names can change — uncomment the one `print(...)` line in `search_grailed_live`
to dump a sample product, then tweak `map_grailed_live()` to match. That mapper
is the **only** place the source is touched.


## ⚠️ Terms of Service

Grailed publishes no official public search API. The `grailed_api`
library reaches Grailed's private endpoints without authorization, contrary to
Grailed's ToS. Running this adapter is a **personal, local, non-commercial**
choice you own — expect blocking/rate-limits and breakage, and don't ship it in
a public or commercial product. For those, use an approved partnership or a
licensed data provider.

## Endpoints

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/grailed?query=&page=&hits_per_page=&price_min=&price_max=&designers=&categories=&sizes=&conditions=&locations=&department=` | `{ listings, total, nbPages, facets, page }` |
| GET | `/grailed/<id>` | single raw item or 404 |

All requests require `Authorization: Bearer <ADAPTER_API_KEY>`.

All list params are comma-separated and applied **source-side** as Algolia
facet filters, so narrowing a search narrows the query rather than trimming a
page. `total`/`nbPages` are Grailed's own `nbHits`/`nbPages`, and `facets`
describe the **entire** result set (not just the current page).

Grailed requires exactly one department per query, so when none is pinned the
adapter queries menswear **and** womenswear and merges. Each department gets a
**full** `hits_per_page` budget — splitting it returned half-empty pages
whenever one department had no matches (e.g. `carhartt` + size 34 is 4102
menswear / 0 womenswear). Departments partition the corpus, so merging page N
of each is gap-free; the search engine is the only layer that slices to a
page.
