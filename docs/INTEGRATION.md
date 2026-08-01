# Connecting real marketplace data

ArchiveScout ships with a **mock data layer** so the full product works out of
the box. Every marketplace is accessed through one interface, so switching a
source from mock → live is a **single-file change** with **zero frontend edits**.

This document explains exactly what each marketplace requires for a **legal,
ToS-compliant** production integration.

---

## The provider contract

Every marketplace implements `MarketplaceProvider`
(`lib/marketplaces/types.ts`):

```ts
interface MarketplaceProvider {
  readonly marketplace: Marketplace;
  readonly isMock: boolean;
  searchListings(params: SearchParams): Promise<Listing[]>;
  getListing?(externalId: string): Promise<Listing | null>;
}
```

A provider's only job is: **take normalized `SearchParams` → return normalized
`Listing[]`.** All merging, deduping, filtering, sorting, and pagination happen
downstream in `lib/search/engine.ts`, untouched by the data source.

The registry (`lib/marketplaces/registry.ts`) is the single place providers are
instantiated. It is imported **only** from server code (the `/api/search` route
and server components), so **credentials never reach the browser**.

### The `DATA_SOURCE` switch — `mock` · `live`

`lib/marketplaces/source.ts` resolves each provider's data source:

| `DATA_SOURCE` | Behaviour |
| --- | --- |
| `mock` (default) | Local mock listings, no network. |
| `live` | Real, **approved** partner feeds via each provider's `*_API_BASE` / `*_API_KEY`; falls back to mock for any provider whose creds are missing. |

Providers fail independently — the engine uses `Promise.allSettled`, so a live
eBay + mock Grailed setup works fine, and a marketplace that errors just
shows a per-marketplace notice.


---

## eBay — official API, FULLY IMPLEMENTED ✅

eBay offers a public, sanctioned **Buy Browse API**, and `EbayProvider` is
complete — no code needed, just credentials.

1. Register an app at <https://developer.ebay.com> → **Application Keys**.
2. Copy the **App ID** (client id) and **Cert ID** (client secret).
3. Put them in `.env.local`:

```bash
DATA_SOURCE=live
EBAY_CLIENT_ID=your_app_id
EBAY_CLIENT_SECRET=your_cert_id
EBAY_ENV=production          # or "sandbox"
EBAY_MARKETPLACE_ID=EBAY_US
```

4. `npm run dev` — eBay results appear alongside Grailed. Without credentials it
   transparently serves mock data, so nothing breaks.

### What's implemented

| Concern | Implementation |
| --- | --- |
| Auth | OAuth 2.0 client-credentials ("application token"), cached in-process until 60 s before expiry (~2 h lifetime) |
| Search | `GET /buy/browse/v1/item_summary/search` |
| Pagination | `offset`/`limit`, chunked at eBay's 200-item max; returns cumulative pages 1..N so the engine stays the only slicing layer |
| Validation | `ebaySearchResponseSchema` (Zod) before mapping |
| Source-side filters | price, condition, free shipping, brand — plus **size and color** via per-category aspect discovery (see below) |
| Source-side sort | `price` / `-price` / `newlyListed`; recommended + best match use eBay relevance |
| Errors | Timeouts + bounded retries via `fetchJson`; failures surface as a per-marketplace notice |

### Size & color: source-side via aspect discovery

eBay has no universal size field — each leaf category exposes its own aspects
(`US Shoe Size` / `EU Shoe Size` for shoes, `Waist Size` (`"34 in"`) + `Size`
for pants, plain `Size` for outerwear). When a size or color filter is active
the provider runs a cached per-query **aspect discovery**
(`lib/marketplaces/ebay-aspects.ts`):

1. `fieldgroups=ASPECT_REFINEMENTS` → dominant category + aspect vocabulary
   (1 request). `fieldgroups` responses carry no items.
2. If the dominant is a meta category (11450) with no size aspects: a plain
   50-item search, tally the items' `leafCategoryIds` → dominant **leaf**,
   then re-fetch refinements scoped to it (2 more requests, cached 10 min).

The search then sends `category_ids=<cat>` +
`aspect_filter=categoryId:<cat>,<Aspect>:{v1|v2}` — filtering happens AT EBAY,
and `appliedFilters` tells the engine not to re-check locally. When a selected
size cannot be mapped for the query's category, eBay **sits the search out
loudly**: empty result + `unsupportedFilters`, rendered as "eBay could not be
filtered by this size for the current category" — never a silent removal.

`getItem` (structured aspects: Size, Brand, Color) runs ONLY when Quick View or
Compare opens, cached by item id — never per search card.

**Category** is not pushed source-side for the category *filter* (eBay uses
numeric ids; the size flow derives them from refinements, but the sidebar's
category names filter locally).

**Brand** priority: aspect-guaranteed (single Brand filter) → eBay's Brand
vocabulary matched against the title → conservative known-brand title fallback
→ undefined.

---

## eBay Marketplace Account Deletion (required for Production keys)

eBay will not enable a **Production** keyset until the app exposes a public
endpoint that answers their ownership challenge and accepts account-deletion
notifications. ArchiveScout implements it at:

```
/api/ebay/account-deletion
```

| Method | Behaviour |
| --- | --- |
| `GET ?challenge_code=…` | `200` + `{"challengeResponse": "<sha256 hex>"}` |
| `GET` (no challenge_code) | `400` |
| `POST` (JSON) | `204` — acknowledged |
| `POST` (non-JSON) | `415` |
| Misconfigured env | `500`, generic message; var names go to the server log only |

The challenge is:

```
SHA256(challengeCode + verificationToken + endpointUrl)   -> lowercase hex
```

**The endpoint string is part of the hash.** `EBAY_DELETION_ENDPOINT` must
byte-for-byte match the URL registered in the eBay Developer Portal — scheme,
host, path, capitalisation, and trailing slash. A mismatch produces a
valid-looking hash that eBay rejects. Register the URL **without** a trailing
slash (Next.js 308-redirects `…/` → `…`, and redirects break verification).

```bash
EBAY_DELETION_VERIFICATION_TOKEN=<32-80 chars, alphanumeric>
EBAY_DELETION_ENDPOINT=https://<your-domain>/api/ebay/account-deletion
```

Neither may be exposed via `NEXT_PUBLIC_`. The route is **public and
unauthenticated by design** — eBay calls it with no credentials. On Vercel,
make sure **Deployment Protection** is off for whichever URL you register;
preview deployments are auth-gated by default and eBay would receive a login
page instead of the challenge response.

### What gets deleted

**Nothing — and that is the correct behaviour today.** ArchiveScout stores no
eBay member personal data: listings are fetched live per request from the
Browse API and never persisted, and the only stored state (favourites, compare,
recent searches) lives in the visitor's own browser local storage and contains
no eBay member identifiers. Acknowledging the notification is the complete
action.

If that ever changes, `handleAccountDeletion()` in
`lib/ebay/account-deletion.ts` is the single seam to fill in — the route
already parses, validates and acknowledges around it. Member identifiers
(`username`, `userId`, `eiasToken`) live under `notification.data`, which the
logger deliberately never reads, so they cannot leak into logs.

### Testing

```bash
npm run test:ebay-deletion -- --base-url http://localhost:3000
```

Verifies the hash against a locally computed SHA-256, plus the 400 / 415 / 204
paths. Set `MISCONFIGURED_BASE_URL` to a server started without the two vars to
also cover the 500 path.

---

## Grailed — no public API ⚠️

Grailed publishes **no public API**, and scraping is prohibited by its Terms of
Service.

Compliant options: an approved Grailed data partnership, or a licensed
aggregator feed. When granted:

```bash
DATA_SOURCE=live
GRAILED_API_BASE=https://your-approved-feed.example.com
GRAILED_API_KEY=...
```

The live pipeline (`fetchJson` → `grailedFeedSchema.parse` → `mapGrailedListing`)
is **already implemented** in `lib/marketplaces/grailed.ts`. Adjust
`grailedRawItemSchema` + `mapGrailedListing` if your feed's shape differs.

### Filter coverage

| Filter | Where it runs | Notes |
| --- | --- | --- |
| Price (min/max) | Source | Algolia `numericFilters` on `price_i` |
| Brand | Source | `designers.name` facet |
| Category | Source | `category_path`; app names are expanded to Grailed's leaf categories (e.g. "Sneakers" → Lowtop + Hitop) |
| Size | Source | `category_size` facet, scoped per size family |
| Condition | Source | `condition` facet |
| Department | Source | `department` facet; only when a real department is picked (Unisex has no equivalent) |
| Location | Source | `location` facet |
| **Color** | **Local** | Grailed exposes **no color facet** — only a per-listing `color` field. Filtered after fetch, with progressive deepening to keep pages full. |
| Free shipping / verified seller / newly listed | Local | No source equivalent |

### Authentication filter (discovered field mapping)

Marketplace-neutral model on `Listing`: `authenticated`, `authenticationSource`
(`grailed` | `ebay` | `therealreal` | `vestiaire`), `authenticationType`
(`marketplace_authentication` | `authenticity_guarantee` | `third_party`).
URL param `auth=1`.

**eBay — supported, source-side.** Field: `qualifiedPrograms` containing
`AUTHENTICITY_GUARANTEE`, mapped to
`{authenticated: true, source: "ebay", type: "authenticity_guarantee"}`.
Two production-verified requirements: the field only appears on item summaries
when the request carries a delivery context, and the
`qualifiedPrograms:{AUTHENTICITY_GUARANTEE}` filter **requires**
`deliveryCountry` + `deliveryPostalCode` (error 12033 otherwise). Both are sent
on every EBAY_US search (result sets are otherwise identical). Never inferred
from category. Non-US marketplaces report the filter unsupported.

**Grailed — NOT supported, and this was verified, not assumed.** Every field in
the live Algolia payload was inspected: the `badges` facet contains only
`staff_pick` across broad and luxury queries; `hit.badges` is empty; `strata`
is a listing tier (`grailed`/`basic`/`hype`); `traits` holds only color and
country_of_origin; the `user` object exposes no authentication field. Grailed
authenticates at CHECKOUT for eligible purchases, so there is no listing-level
indicator to filter or badge on. Trusted-seller is explicitly NOT authentication
and is never used as a proxy. The provider returns
`unsupportedFilters: ["authenticatedOnly"]` and the UI says so plainly rather
than silently including unauthenticated listings.

### Query variants & the normalized filter model

Marketplaces tokenize differently (Grailed's Algolia does not stem — "chanel
running" ≠ "chanel runner"), so the engine expands each query into a small,
conservative set of variants (`lib/search/query-variants.ts`, capped at 3,
generic garment vocabulary only — never brand names), searches all of them per
marketplace, and dedupes by listing id. The original query stays canonical in
the UI and for ranking; merged `sourceTotal` is the MAX across variants (sets
overlap — summing would fabricate inventory).

Filters are marketplace-neutral (`NormalizedSearchFilters` in
`lib/marketplaces/types.ts`). Sizes carry a garment-family type through the
URL as `footwear:13` / `waist:34` / `clothing:l` tokens
(`lib/search/normalized-filters.ts`) — the grouped size UI knows which scale
a chip belongs to, so "13 the shoe" stops matching size-13 tops. The Grailed
adapter scopes `category_size` facets to that family; eBay restricts which
aspects a value may map to (EU 39 → only "EU Shoe Size"). Bare values remain
fully supported everywhere.

A provider reports what it handled via `ProviderSearchResult.appliedFilters`,
and the engine **skips those dimensions locally**. This matters: re-checking a
source-applied filter against a listing field deletes correct results whenever
the vocabularies differ — Grailed answers a `Sneakers` category filter with
items labelled `Lowtop Sneakers`, and a `Carhartt` brand filter with
`Carhartt × Carhartt Wip × Vintage`. Any new provider must declare
`appliedFilters` for every filter it pushes source-side.

> **On unofficial "Grailed API" libraries (e.g. reverse-engineered Algolia
> wrappers).** These call Grailed's private endpoints without authorization and
> violate Grailed's Terms of Service — the library's own docs typically note
> "there is no official API." Do **not** point `GRAILED_API_BASE` at one for a
> public or commercial deployment: expect blocking/rate-limits, silent breakage
> when endpoints change, and account/legal exposure. Only use an **approved**
> partnership or a **licensed** aggregator that holds redistribution rights.

---

## Adding a brand-new marketplace

1. Create `lib/marketplaces/<name>.ts` implementing `MarketplaceProvider`,
   with a `map<Name>Item()` normalizer.
2. Add the id to the `MARKETPLACES` tuple and `MARKETPLACE_LABELS` in
   `lib/marketplaces/types.ts` (this flows types through the whole app).
3. Register it in `lib/marketplaces/registry.ts`.
4. Add a badge style in `components/listings/marketplace-badge.tsx`.

No frontend, engine, or filter code needs to change.

---

## Enabling price-alert emails

Saved searches already persist a `price_alert` boolean (`supabase/schema.sql`).
To actually send alerts:

1. Schedule a job (Supabase cron / Edge Function / external worker).
2. For each `saved_searches` row where `price_alert = true`, run the search via
   the same engine and compare the lowest `totalPrice` against
   `max_desired_price`.
3. On a match, send an email (Resend, Postmark, Supabase Auth email, etc.).

The MVP stores the intent; wiring the notifier is additive and needs no UI
changes.
