# ArchiveScout

**Search every resale marketplace at once.** ArchiveScout brings eBay and
Grailed into a single search so you can find, compare, save, and track
fashion listings from one premium interface.

> This is a fully functional **MVP built on realistic mock data**. Every
> marketplace is accessed through a swappable provider, so real APIs / approved
> feeds can be connected later **without rebuilding the frontend**. See
> [`docs/INTEGRATION.md`](docs/INTEGRATION.md).

---

## Features

- 🔎 **Unified search** across eBay and Grailed with a merged result feed
- 🎛️ **Rich filtering** — marketplace, price, size, brand, category, condition,
  color, gender, location, free shipping, verified seller, newly listed
- ↕️ **Sorting** — recommended, price (low/high), newest, best match
- 🔗 **Shareable searches** — all state lives in the URL query string
- 🖼️ **Grid & list views** with a **quick-view** product modal + image gallery
- ⚖️ **Compare up to 4 listings** side by side with best-value highlights
- ❤️ **Favorites** and **saved searches** with **price-alert** toggles
- 🕑 **Recent searches**, polished **loading / empty / error** states
- 🔐 **Supabase auth** ready (works locally without it), with SQL schema + RLS
- ♿ Accessible, responsive, SEO-ready (dynamic metadata, robots, sitemap)

---

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn-style UI · Lucide
icons · Zod · Supabase (Postgres + Auth).

---

## Getting started

```bash
npm install
cp .env.example .env.local   # optional — the app runs with mock data as-is
npm run dev
```

Open <http://localhost:3000>. No environment variables are required for the
mock experience.

Useful scripts:

```bash
npm run dev          # start the dev server (mock data)
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint

# Live marketplace data via the local adapter service (see below)
npm run adapter      # start the Grailed adapter on :8787
npm run dev:all      # app (wired to adapter) + adapter, one command
```

`dev:all` boots both processes together (labeled `app` / `adapter` logs) with
the app already pointed at `http://localhost:8787`, so Grailed returns live
results. Requires `pip install grailed_api`. See
[services/marketplace-adapter/](services/marketplace-adapter/README.md).

---

## Architecture

```
Browser (URL query params = source of truth)
   │
   ├─ app/page.tsx            Homepage: hero, search, trending, featured grid
   ├─ app/search/page.tsx     Results: filters, sort, grid/list, states
   ├─ app/compare/page.tsx    Side-by-side comparison (up to 4)
   ├─ app/saved/page.tsx      Favorites
   ├─ app/searches/page.tsx   Saved-search dashboard + price alerts
   └─ app/signin/page.tsx     Supabase auth (graceful demo fallback)
        │
        ▼  GET /api/search  (server only — credentials never exposed)
   lib/search/engine.ts
     validate (zod) → fan out via Promise.allSettled → normalize →
     merge → dedupe → filter → sort → paginate → { listings, facets, status }
        │
        ▼
   lib/marketplaces/  registry → { Ebay | Grailed | Mock }Provider
     every provider returns the normalized `Listing` type
```

### Why the URL is the source of truth

The query, selected marketplaces, every filter, and the sort option are encoded
in the URL. This makes searches **shareable and bookmarkable**, makes the
browser back/forward buttons behave, and keeps the client a thin render layer
over `GET /api/search`.

### Client state (no login required)

Favorites, comparisons, recent + saved searches use React Context backed by
`localStorage` (`lib/store/*`), so the whole app is usable immediately. Supabase
is prepared behind the same shape for cross-device sync once auth is enabled.

---

## Project structure

```
app/
  page.tsx · search/ · saved/ · searches/ · compare/ · signin/
  api/search/route.ts · robots.ts · sitemap.ts · layout.tsx · globals.css
components/
  layout/     navbar, footer, logo
  search/     search-bar, results toolbar, states, recent searches
  filters/    filter-panel, URL updater hook
  listings/   product-card, quick-view, compare-drawer, badges, buttons
  compare/ · saved/ · searches/ · auth/
  ui/         button, input, badge, checkbox, select, dialog, sheet, skeleton
lib/
  marketplaces/  types, registry, ebay, grailed, mock, mock-data
  search/        engine, params (zod), dedupe, filter-sort, client
  store/         favorites, compare, searches (localStorage-backed)
  supabase/      client, server, config, types
  compare.ts · listings.ts · constants.ts · utils.ts
supabase/schema.sql        tables + Row Level Security
docs/INTEGRATION.md        how to connect real marketplace data (legally)
types/                     shared app types
```

---

## Data & legal note

All listings shown are **mock data**; images are safe seeded placeholders.
ArchiveScout is **not affiliated** with any marketplace. Only **eBay** exposes a
public, sanctioned search API. **Grailed** has **no public API**, and scraping
it violates its Terms of Service — a production integration there requires an
**approved partnership or licensed feed**. The providers are built so this can
never happen accidentally: the live branch throws until you supply approved
credentials. Details in
[`docs/INTEGRATION.md`](docs/INTEGRATION.md).

---

## Environment variables

See [`.env.example`](.env.example). All optional for the mock experience:

| Variable | Purpose |
| --- | --- |
| `DATA_SOURCE` | `mock` (default) or `live` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase auth + data |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase admin (future jobs) |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | eBay Browse API |
| `GRAILED_*` | Approved partner feed only |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL for metadata/sitemap |
```
