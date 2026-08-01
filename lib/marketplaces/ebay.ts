import { MockMarketplaceProvider } from "./mock";
import { fetchJson, MarketplaceRequestError } from "./http";
import {
  ebayItemDetailSchema,
  ebaySearchResponseSchema,
  ebayTokenSchema,
  type EbayItemDetail,
  type EbayItemSummary,
} from "./schemas";
import {
  aspectImpliedFamily,
  brandFromVocabulary,
  catalogFromRefinement,
  hasSizeAspect,
  selectColorAspect,
  selectSizeAspect,
  topLeafCategories,
  type AspectCatalog,
  type AspectSelection,
} from "./ebay-aspects";
import {
  categoryFamily,
  queryGarmentFamily,
  type GarmentFamily,
} from "@/lib/search/size-invariant";
import { titleSizeMatch } from "./ebay-title-sizes";
import {
  collectAspects,
  aspect,
  parseDepartment,
  parseVerifiedSize,
} from "./ebay-detail-aspects";
import {
  CONDITIONS,
  type Condition,
  type Listing,
  type ListingDetail,
  type MarketplaceProvider,
  type ProviderSearchResult,
  type SearchFilters,
  type SearchParams,
} from "./types";

/**
 * eBay Browse API provider — the one OFFICIAL, ToS-compliant marketplace
 * integration in ArchiveScout.
 *
 * Docs: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 *
 * Auth: OAuth 2.0 client-credentials ("application token"), cached in-process
 * until shortly before expiry. Credentials are read from env on the SERVER only
 * — never import this from a client component.
 *
 * Activate by setting in .env.local:
 *   DATA_SOURCE=live
 *   EBAY_CLIENT_ID=...
 *   EBAY_CLIENT_SECRET=...
 *   EBAY_ENV=production   # or sandbox
 * Without those it transparently serves mock data.
 *
 * NOTE: EBAY_ENV=sandbox refers to eBay's OWN sandbox API, unrelated to any
 * ArchiveScout data mode.
 */

const HOSTS = {
  production: "https://api.ebay.com",
  sandbox: "https://api.sandbox.ebay.com",
} as const;

/** eBay allows up to 200 items per request — fetch in big chunks. */
const MAX_LIMIT = 200;

/**
 * Delivery context sent with every EBAY_US search. Two jobs:
 * 1. It makes item summaries carry `qualifiedPrograms` per item (verified in
 *    production: the field appears ONLY when this context is present), so
 *    Authenticity Guarantee coverage is per-listing source data.
 * 2. The `qualifiedPrograms:{AUTHENTICITY_GUARANTEE}` filter REQUIRES it
 *    (eBay error 12033 without it).
 * The zip is a generic US destination — result sets are identical with and
 * without it (verified: same totals), it only enables the program fields.
 */
const US_DELIVERY_CONTEXT = { country: "US", postalCode: "10001" } as const;

/* ───────────────────────────── token cache ───────────────────────────── */

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}
let tokenCache: CachedToken | null = null;

/* ─────────────────────── aspect-catalog cache ───────────────────────
 * Discovery (which size/color aspects the dominant category exposes) costs 1–2
 * extra requests, so it runs ONLY when a size/color filter is active and is
 * cached per query. Load More and repeat searches reuse the plan.
 */
const CATALOG_TTL_MS = 10 * 60 * 1000;
const catalogCache = new Map<string, { catalogs: AspectCatalog[]; expiresAt: number }>();

/** Max leaf categories queried per size/color-filtered search. Sized items for
 *  one query live in SEVERAL leaves (women's + men's athletic shoes, …) and
 *  eBay allows only ONE category per aspect-filtered request, so we fan out —
 *  bounded to keep the request count predictable. */
const MAX_PLAN_CATEGORIES = 3;

/* ───────────────────────── item-detail cache ─────────────────────────
 * getItem is reserved for Quick View / Compare / detail pages — never issued
 * during a normal search. Keyed `ebay:item:<id>`; active listings cache for
 * 30 min, ended/removed ones briefly (they can't come back, but a short TTL
 * keeps the map honest); transient failures are NOT cached at all. In-flight
 * requests are deduplicated so two surfaces opening the same item cost one
 * upstream call.
 */
const DETAIL_TTL_ACTIVE_MS = 30 * 60 * 1000;
const DETAIL_TTL_UNAVAILABLE_MS = 2 * 60 * 1000;
interface DetailCacheEntry {
  detail: ListingDetail;
  fetchedAt: number;
  expiresAt: number;
  status: "active" | "unavailable";
}
const detailCache = new Map<string, DetailCacheEntry>();
const detailInFlight = new Map<string, Promise<ListingDetail>>();

/** Dev-only counters proving the request policy (searches make 0 getItem calls). */
export const ebayDetailMetrics = { requests: 0, cacheHits: 0 };

/** One category's worth of source-side aspect filtering. */
interface PlanEntry {
  categoryId: string;
  size: AspectSelection | null;
  color: AspectSelection | null;
}

/** The full plan: one aspect-filtered request per entry, results merged. */
type AspectPlan = PlanEntry[];

/* ─────────────────────────── condition mapping ─────────────────────────── */

/**
 * conditionId → normalized condition. Preferred over text parsing: ids are
 * deterministic and locale-proof (the text arrives as "Gebraucht - Gut",
 * "Usato - Buono", … for foreign-listed items). Tiers follow eBay's ladder:
 * 1000 NWT · 1500/1750 new-other/imperfections · 2000–2750 refurbished ·
 * 2990 pre-owned excellent · 3000/4000/5000 good–very good · 3010/6000 fair.
 */
const CONDITION_BY_ID: Record<string, Condition> = {
  "1000": "New with tags",
  "1500": "New without tags",
  "1750": "New without tags",
  "2000": "Excellent",
  "2010": "Excellent",
  "2020": "Excellent",
  "2030": "Excellent",
  "2500": "Excellent",
  "2750": "Excellent",
  "2990": "Excellent",
  "3000": "Good",
  "4000": "Good",
  "5000": "Good",
  "3010": "Fair",
  "6000": "Fair",
};

/** eBay condition (id first, then text) → ArchiveScout's normalized condition. */
function mapCondition(raw?: string | null, conditionId?: string | null): Condition | undefined {
  if (conditionId && CONDITION_BY_ID[conditionId]) return CONDITION_BY_ID[conditionId];
  if (!raw) return undefined;
  const c = raw.toLowerCase();
  if (c.includes("with tag") || c.includes("with box")) return "New with tags";
  if (c.includes("without tag") || c.includes("without box")) return "New without tags";
  if (c === "new" || c.includes("brand new")) return "New with tags";
  // Round-trip consistency with CONDITION_FILTER below: LIKE_NEW is filtered
  // under "New without tags" and USED_VERY_GOOD under "Good", so they must
  // DISPLAY as those tiers too — otherwise a Good-filtered search shows
  // "Excellent" cards and the filter looks broken.
  if (c.includes("like new") || c.includes("open box")) return "New without tags";
  if (c.includes("excellent")) return "Excellent";
  if (c.includes("very good")) return "Good";
  if (c.includes("good")) return "Good";
  if (c.includes("acceptable") || c.includes("for parts")) return "Fair";
  if (c.includes("pre-owned") || c.includes("used")) return "Good";
  // Already one of ours?
  return (CONDITIONS as readonly string[]).includes(raw)
    ? (raw as Condition)
    : undefined;
}

/** ArchiveScout condition → eBay `conditions` filter enum values. */
const CONDITION_FILTER: Record<Condition, string[]> = {
  "New with tags": ["NEW"],
  "New without tags": ["NEW_OTHER", "LIKE_NEW"],
  Excellent: ["USED_EXCELLENT"],
  Good: ["USED_VERY_GOOD", "USED_GOOD"],
  Fair: ["USED_ACCEPTABLE"],
};

/* ───────────────── title fallback for brand / size ─────────────────
 * eBay's item_summary returns no structured brand/size aspects. The PRIMARY
 * sources are aspect-driven: source-side aspect filtering stamps the filtered
 * value on every result, eBay's own Brand vocabulary (from discovery) matches
 * titles, and getItem supplies full aspects for Quick View / Compare. These
 * title extractors are the LAST resort only: brand on an exact known-brand
 * match, size on an explicit "Size X" / "34x32" pattern — anything uncertain
 * stays undefined rather than guessed.
 */
const KNOWN_BRANDS = [
  "Chanel", "Carhartt", "Balenciaga", "Levi's", "Levis", "Chrome Hearts",
  "Maison Margiela", "Margiela", "Stone Island", "Nike", "Adidas", "Jordan",
  "The North Face", "Arc'teryx", "Arcteryx", "Supreme", "Rick Owens",
  "Comme des Garçons", "Comme des Garcons", "Acne Studios", "Our Legacy",
  "Undercover", "Champion", "Ralph Lauren", "Polo Ralph Lauren", "Patagonia",
  "Yohji Yamamoto", "Issey Miyake", "Raf Simons", "Helmut Lang", "Prada",
  "Gucci", "Dior", "Louis Vuitton", "Bape", "Stussy", "Palace", "Vetements",
  "Off-White", "Fear of God", "Essentials", "Kapital", "Visvim", "Needles",
];

function extractBrand(title: string): string | undefined {
  const lower = title.toLowerCase();
  // Longest match first so "Polo Ralph Lauren" beats "Ralph Lauren".
  const match = [...KNOWN_BRANDS]
    .sort((a, b) => b.length - a.length)
    .find((b) => lower.includes(b.toLowerCase()));
  if (!match) return undefined;
  return match === "Levis" ? "Levi's" : match === "Margiela" ? "Maison Margiela" : match;
}

function extractSize(title: string): string | undefined {
  // "34x32" / "34 x 32" waist-inseam
  const wx = title.match(/\b(\d{2})\s?[xX]\s?(\d{2})\b/);
  if (wx) return `${wx[1]}x${wx[2]}`;
  // "Size 10.5" / "Size M" / "Size XL"
  const sz = title.match(/\bsize[:\s]+((?:\d{1,2}(?:\.5)?)|(?:XX?S|S|M|L|XX?L|XXXL))\b/i);
  if (sz) return sz[1].toUpperCase().length <= 4 ? sz[1].toUpperCase() : sz[1];
  return undefined;
}


/**
 * eBay's Browse API hands out the 225px THUMBNAIL as `image.imageUrl`
 * (`…/s-l225.jpg`), which upscales blurrily in large product cards. The same
 * CDN asset exists at every rung of the s-l ladder, so request the 1600px
 * variant. Non-matching URLs pass through untouched.
 */
function upgradeEbayImage(url: string): string {
  return url.replace(/\/s-l\d+(\.(?:jpg|jpeg|png|webp))$/i, "/s-l1600$1");
}

/* ───────────────────────────── the provider ───────────────────────────── */

export class EbayProvider implements MarketplaceProvider {
  readonly marketplace = "ebay" as const;
  readonly isMock: boolean;

  private readonly clientId = process.env.EBAY_CLIENT_ID;
  private readonly clientSecret = process.env.EBAY_CLIENT_SECRET;
  private readonly host =
    (process.env.EBAY_ENV ?? "production").toLowerCase() === "sandbox"
      ? HOSTS.sandbox
      : HOSTS.production;
  private readonly marketplaceId = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US";
  /** "EBAY_GB" -> "GB". Used for the buyer-context header. */
  private readonly countryCode =
    (process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US").replace(/^EBAY_/, "").slice(0, 2) || "US";
  private readonly fallback = new MockMarketplaceProvider("ebay");

  constructor() {
    // Only go live when DATA_SOURCE=live AND both credentials are present.
    this.isMock = !(
      process.env.DATA_SOURCE === "live" &&
      this.clientId &&
      this.clientSecret
    );
  }

  /** OAuth 2.0 client-credentials application token, cached until near expiry. */
  private async getAppToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    });

    const res = await fetch(`${this.host}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new MarketplaceRequestError(
        `eBay auth failed (${res.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
        res.status,
      );
    }

    const parsed = ebayTokenSchema.parse(await res.json());
    tokenCache = {
      token: parsed.access_token,
      // expires_in is seconds (typically 7200); refresh a minute early.
      expiresAt: now + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }

  /**
   * Cumulative source pagination: returns results for engine pages 1..N so the
   * engine remains the single slicing layer (same contract as GrailedProvider).
   * eBay allows limit<=200, so one request usually covers several UI pages.
   */
  async searchListings(params: SearchParams): Promise<ProviderSearchResult> {
    if (this.isMock) return this.fallback.searchListings(params);

    const token = await this.getAppToken();
    const f = params.filters;
    const needed = params.page * params.perPage;

    /* ── Source-side size/color via category aspects ──
     * When a size or color filter is active, discover the dominant category's
     * aspect vocabulary (cached per query) and translate the user's values
     * into an exact aspect_filter. If NOTHING maps, eBay sits the search out
     * LOUDLY — empty result + unsupportedFilters — instead of returning
     * unfiltered items for the local pass to silently delete.
     */
    /* ── Trust ──
     * eBay supports:
     *   guarantee → source-side qualifiedPrograms filter (EBAY_US only: the
     *               filter requires a US delivery context)
     *   trusted   → topRatedBuyingExperience, per item (no source-side filter
     *               exists), enforced by the engine's local pass
     * eBay has no "marketplace authenticated" program distinct from the
     * guarantee, so a trust selection of ONLY `authenticated` cannot be
     * satisfied — reported unsupported rather than silently unfiltered.
     */
    const trust = f.trust ?? [];
    if (trust.length > 0) {
      const supported = trust.filter(
        (o) =>
          o === "trusted" || (o === "guarantee" && this.marketplaceId === "EBAY_US"),
      );
      if (supported.length === 0) {
        return {
          listings: [],
          hasMore: false,
          sourceTotal: 0,
          unsupportedFilters: ["trust"],
        };
      }
    }

    let plan: AspectPlan | null = null;
    if (f.sizes?.length || f.colors?.length) {
      const catalogs = await this.getAspectCatalogs(params.query, token);
      // An entry is usable only when EVERY active aspect dimension maps in
      // that category — a category matching size but not the selected color
      // would return wrongly-colored items.
      const entries: PlanEntry[] = [];
      for (const catalog of catalogs) {
        const size = f.sizes?.length
          ? selectSizeAspect(f.sizes, catalog, f.sizeFilters)
          : null;
        const color = f.colors?.length ? selectColorAspect(f.colors, catalog) : null;
        let rejectionReason: string | null = null;
        if (f.sizes?.length && !size) rejectionReason = "no size aspect mapped";
        if (!rejectionReason && f.colors?.length && !color)
          rejectionReason = "no color aspect mapped";
        if (!rejectionReason && size) {
          rejectionReason = validateEntryFamily(
            catalog,
            size,
            f.sizeFilters,
            params.query,
          );
        }
        if (process.env.NODE_ENV !== "production" && size) {
          const sel = f.sizeFilters?.find((d) =>
            size.mappedUserValues.some(
              (v) => v.toLowerCase() === d.value.toLowerCase(),
            ),
          );
          // eslint-disable-next-line no-console
          console.log("[ebay-size-plan]", {
            query: params.query,
            selectedSize: sel ?? size.mappedUserValues,
            categoryId: catalog.categoryId,
            categoryName: catalog.categoryName,
            inferredFamily:
              categoryFamily(catalog.categoryName) ?? aspectImpliedFamily(catalog),
            aspectName: size.aspectName,
            aspectValue: size.values.join("|"),
            accepted: !rejectionReason,
            rejectionReason,
          });
        }
        if (rejectionReason) continue;
        entries.push({ categoryId: catalog.categoryId, size, color });
      }

      if (entries.length === 0) {
        const unsupported: (keyof SearchFilters)[] = [];
        if (f.sizes?.length) unsupported.push("sizes");
        if (f.colors?.length) unsupported.push("colors");
        return {
          listings: [],
          hasMore: false,
          sourceTotal: 0,
          unsupportedFilters: unsupported,
        };
      }
      plan = entries;

      if (process.env.NODE_ENV !== "production") {
        for (const e of entries) {
          // eslint-disable-next-line no-console
          console.log(
            `[ebay] aspect plan q="${params.query}" cat=${e.categoryId}` +
              (e.size ? ` ${e.size.aspectName}:{${e.size.values.join("|")}}` : "") +
              (e.color ? ` Color:{${e.color.values.join("|")}}` : ""),
          );
        }
      }
    }

    /* One request chain per plan entry (or a single unplanned chain), fetched
     * in PARALLEL and merged. Items appearing in two leaves dedupe by id. */
    const chains: (PlanEntry | null)[] = plan ?? [null];
    const results = await Promise.all(
      chains.map(async (entry) => {
        const items: EbayItemSummary[] = [];
        let total: number | undefined;
        for (let offset = 0; offset < needed; offset += MAX_LIMIT) {
          const limit = Math.min(MAX_LIMIT, needed - offset);
          const url = buildEbaySearchUrl(this.host, params, offset, limit, entry);
          const raw = await fetchJson(url, {
            headers: this.requestHeaders(token),
            timeoutMs: 10_000,
            retries: 2,
            revalidate: 60,
          });
          const feed = ebaySearchResponseSchema.parse(raw);
          if (feed.total != null) total = feed.total;
          items.push(...feed.itemSummaries);
          if (feed.itemSummaries.length < limit) break; // source exhausted
        }
        return { items, total };
      }),
    );

    /* ── Title-verified supplement (recall) ──
     * Aspect filtering only sees listings whose sellers filled the structured
     * size aspect. Many real listings state the size ONLY in the title
     * ("Size 43( 10", "Sz 42(9)", "12 US") — eBay's own site finds them via
     * text search. For each typed size value (capped), run one text search
     * and keep ONLY items whose title provably states that size in the
     * filter's own system AND whose category confirms the garment family.
     * The verified value (the listing's own wording) becomes its size — the
     * filter value itself is never copied. Totals from this fuzzy text search
     * are NOT added to sourceTotal.
     */
    const supplemental = new Map<string, { item: EbayItemSummary; size: string }>();
    if (plan && f.sizeFilters?.length) {
      const typedValues = f.sizeFilters.filter((s) => s.type).slice(0, 2);
      await Promise.all(
        typedValues.map(async (sel) => {
          const url = buildEbaySearchUrl(
            this.host,
            { ...params, query: `${params.query} size ${sel.value}` },
            0,
            100,
            null,
          );
          try {
            const raw = await fetchJson(url, {
              headers: this.requestHeaders(token),
              timeoutMs: 10_000,
              retries: 1,
              revalidate: 60,
            });
            const feed = ebaySearchResponseSchema.parse(raw);
            for (const item of feed.itemSummaries) {
              const verified = titleSizeMatch(item.title, sel);
              if (!verified) continue;
              const family = categoryFamily(item.categories?.[0]?.categoryName ?? undefined);
              if (family !== sel.type) continue; // confirmed family only
              if (!supplemental.has(item.itemId)) {
                supplemental.set(item.itemId, { item, size: verified });
              }
            }
          } catch {
            /* supplement is best-effort — aspect results stand on their own */
          }
        }),
      );
      if (process.env.NODE_ENV !== "production" && typedValues.length) {
        // eslint-disable-next-line no-console
        console.log(
          `[ebay] title-verified supplement q="${params.query}" ` +
            `values=${typedValues.map((s) => s.value).join(",")} kept=${supplemental.size}`,
        );
      }
    }

    // Merge + dedupe by itemId (an item can be listed under two leaves, and
    // paged feeds can repeat items).
    const seen = new Set<string>();
    const unique: EbayItemSummary[] = [];
    for (const r of results) {
      for (const i of r.items) {
        if (seen.has(i.itemId)) continue;
        seen.add(i.itemId);
        unique.push(i);
      }
    }
    const supplementalKept: { item: EbayItemSummary; size: string }[] = [];
    for (const s of supplemental.values()) {
      if (seen.has(s.item.itemId)) continue;
      seen.add(s.item.itemId);
      supplementalKept.push(s);
    }
    // Sum of per-category totals (tiny overlap possible for dual-leaf items).
    const totals = results.map((r) => r.total).filter((n): n is number => n != null);
    const sourceTotal = totals.length ? totals.reduce((a, b) => a + b, 0) : undefined;
    const fetched = results.reduce((n, r) => n + r.items.length, 0);

    // Mapping context. NO filter value is ever copied onto a listing — size,
    // brand and color must come from the listing's own verified data (title
    // extraction here, full aspects via getItem in Quick View / Compare).
    // brandVocab is eBay's own Brand vocabulary matched against each TITLE,
    // which is listing data, not filter data.
    const catalogs = catalogCache.get(this.catalogKey(params.query))?.catalogs ?? [];
    const ctx: MapContext = {
      brandVocab: [...new Set(catalogs.flatMap((c) => c.brands))],
    };

    const listings = [
      ...unique.map((i) => mapEbayItem(i, ctx)),
      // Supplemental items carry the size their OWN title states (never the
      // filter value) — that is what satisfied the match above.
      ...supplementalKept.map(({ item, size }) => ({
        ...mapEbayItem(item, ctx),
        size,
      })),
    ];

    return {
      listings,
      hasMore:
        sourceTotal !== undefined ? unique.length < sourceTotal : fetched >= needed,
      sourceTotal,
      appliedFilters: sourceAppliedFilters(f, plan),
    };
  }

  /** Standard Browse API headers (buyer-context locale included). */
  private requestHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
      // Buyer locale, so shipping costs are for the right destination.
      // eBay requires the inner key=value percent-encoded (`country%3DUS`);
      // a literal "=" is rejected/ignored.
      "X-EBAY-C-ENDUSERCTX": `contextualLocation=country%3D${this.countryCode}`,
    };
  }

  private catalogKey(query: string): string {
    return `${this.marketplaceId}|${query.trim().toLowerCase()}`;
  }

  /** One Browse search request for aspect discovery, parsed. */
  private async discoveryRequest(
    token: string,
    query: string,
    extra: Record<string, string>,
  ) {
    const url = new URL(`${this.host}/buy/browse/v1/item_summary/search`);
    url.searchParams.set("q", query || "fashion");
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    const raw = await fetchJson(url, {
      headers: this.requestHeaders(token),
      timeoutMs: 10_000,
      retries: 2,
      revalidate: 300,
    });
    return ebaySearchResponseSchema.parse(raw);
  }

  /**
   * Discover aspect vocabularies for a query — one catalog per size-bearing
   * category, up to MAX_PLAN_CATEGORIES.
   *
   * Request A: refinements only (`fieldgroups` responses carry NO item
   * summaries, so limit=1). If the dominant category already exposes a size
   * aspect ("carhartt double knee" → 57989 with Waist Size), one request
   * suffices. For broad queries eBay reports a meta category with no size
   * aspects — and scoping by it does NOT descend — so:
   *
   * Request B: a plain item search (limit 50, no fieldgroups) whose items'
   * own leafCategoryIds are tallied, then per top leaf
   * Request C_n: refinements scoped to that leaf. Multiple leaves matter:
   * "chanel running" size-13 pairs live across women's athletic (95672),
   * men's athletic (15709) AND casual shoes — and eBay allows only ONE
   * category per aspect-filtered request, so each becomes its own plan entry.
   *
   * 1 request for aspect-rich dominants, up to 2+MAX_PLAN_CATEGORIES for
   * meta-category queries — cached per query for CATALOG_TTL_MS, so Load More
   * reuses the plan. Failures resolve to [] (→ honest unsupported messaging).
   */
  private async getAspectCatalogs(
    query: string,
    token: string,
  ): Promise<AspectCatalog[]> {
    const key = this.catalogKey(query);
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.catalogs;

    let catalogs: AspectCatalog[] = [];
    try {
      const feedA = await this.discoveryRequest(token, query, {
        limit: "1",
        fieldgroups: "ASPECT_REFINEMENTS,CATEGORY_REFINEMENTS,CONDITION_REFINEMENTS",
      });

      if (feedA.refinement?.dominantCategoryId && hasSizeAspect(feedA.refinement)) {
        catalogs = [
          catalogFromRefinement(feedA.refinement.dominantCategoryId, feedA.refinement),
        ];
      } else {
        const feedB = await this.discoveryRequest(token, query, { limit: "50" });
        const leaves = topLeafCategories(feedB.itemSummaries, MAX_PLAN_CATEGORIES);
        const scoped = await Promise.all(
          leaves.map(async (leaf) => {
            try {
              const feedC = await this.discoveryRequest(token, query, {
                category_ids: leaf.categoryId,
                limit: "1",
                fieldgroups: "ASPECT_REFINEMENTS",
              });
              return feedC.refinement && hasSizeAspect(feedC.refinement)
                ? catalogFromRefinement(
                    leaf.categoryId,
                    feedC.refinement,
                    leaf.categoryName,
                  )
                : null;
            } catch {
              return null;
            }
          }),
        );
        catalogs = scoped.filter((c): c is AspectCatalog => c !== null);
      }
    } catch (err) {
      catalogs = []; // discovery failure → filter reported unsupported
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error(`[ebay] aspect discovery failed for "${query}":`, err);
      }
    }

    catalogCache.set(key, { catalogs, expiresAt: Date.now() + CATALOG_TTL_MS });
    return catalogs;
  }

  /** Interface-compatible single-listing lookup (delegates to detail). */
  async getListing(externalId: string): Promise<Listing | null> {
    if (this.isMock) return this.fallback.getListing(externalId);
    try {
      const detail = await this.getListingDetail(externalId);
      return detail.availability === "active" ? detail : null;
    } catch {
      return null;
    }
  }

  /**
   * Item detail via getItem — used ONLY for Quick View / Compare / explicit
   * detail requests. Returns the full listing with VERIFIED aspects (size,
   * brand, color, department, material) that item_summary omits, plus an
   * explicit availability so ended/removed listings render honestly.
   *
   * Throws only on transient failure (network/5xx) — a missing/ended listing
   * resolves as { availability: "unavailable" }.
   */
  async getListingDetail(externalId: string): Promise<ListingDetail> {
    const key = `ebay:item:${externalId}`;
    const now = Date.now();

    const cached = detailCache.get(key);
    if (cached && cached.expiresAt > now) {
      ebayDetailMetrics.cacheHits += 1;
      this.logDetail(externalId, cached.detail, true);
      return cached.detail;
    }

    // Deduplicate concurrent requests for the same item.
    const inFlight = detailInFlight.get(key);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<ListingDetail> => {
      let detail: ListingDetail;
      try {
        const raw = await this.getItemWithTokenRetry(externalId);
        detail = mapEbayDetail(ebayItemDetailSchema.parse(raw));
      } catch (err) {
        if (
          err instanceof MarketplaceRequestError &&
          err.status !== undefined &&
          (err.status === 404 || err.status === 400 || err.status === 410)
        ) {
          // eBay reports removed/ended/unknown items as request errors —
          // an honest, cacheable "unavailable", not a failure.
          detail = unavailableDetail(externalId);
        } else {
          throw err; // transient — surface it, cache nothing
        }
      }
      ebayDetailMetrics.requests += 1;
      detailCache.set(key, {
        detail,
        fetchedAt: now,
        expiresAt:
          now +
          (detail.availability === "active"
            ? DETAIL_TTL_ACTIVE_MS
            : DETAIL_TTL_UNAVAILABLE_MS),
        status: detail.availability,
      });
      this.logDetail(externalId, detail, false);
      return detail;
    })();

    detailInFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      detailInFlight.delete(key);
    }
  }

  /** getItem with one forced token refresh on 401 (expired app token). */
  private async getItemWithTokenRetry(externalId: string): Promise<unknown> {
    const url = new URL(
      `${this.host}/buy/browse/v1/item/${encodeURIComponent(externalId)}`,
    );
    const attempt = async () =>
      fetchJson(url, {
        headers: this.requestHeaders(await this.getAppToken()),
        timeoutMs: 10_000,
        retries: 1,
        revalidate: 300,
      });
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof MarketplaceRequestError && err.status === 401) {
        tokenCache = null; // token expired mid-lifetime — refresh once
        return attempt();
      }
      throw err;
    }
  }

  private logDetail(itemId: string, detail: ListingDetail, cacheHit: boolean): void {
    if (process.env.NODE_ENV === "production") return;
    // eslint-disable-next-line no-console
    console.log("[ebay-detail]", {
      itemId,
      cacheHit,
      requestMade: !cacheHit,
      sizeAspect: detail.verifiedSize
        ? `${detail.verifiedSize.type}${detail.verifiedSize.system ? `/${detail.verifiedSize.system}` : ""}`
        : undefined,
      sizeValue: detail.verifiedSize?.value,
      category: detail.category,
      availability: detail.availability,
      totals: { ...ebayDetailMetrics },
    });
  }
}

/** Minimal honest record for a listing eBay no longer serves. */
function unavailableDetail(externalId: string): ListingDetail {
  return {
    id: `ebay:${externalId}`,
    marketplace: "ebay",
    externalId,
    title: "Listing no longer available",
    price: 0,
    currency: "USD",
    imageUrls: [],
    listingUrl: `https://www.ebay.com/itm/${externalId.split("|")[1] ?? externalId}`,
    availability: "unavailable",
  };
}

/**
 * Family gate for an aspect plan entry (returns a rejection reason or null).
 *
 * The rule that fixes the handbag leak: a GENERIC "Size" aspect is only
 * trustworthy when the category itself is confirmed to belong to the size's
 * garment family. "Women's Bags & Handbags" exposing Size:{13} must never
 * become a plan for a footwear-13 filter. Family-specific aspects (US Shoe
 * Size, Waist Size) carry their own family and self-validate.
 */
function validateEntryFamily(
  catalog: AspectCatalog,
  size: AspectSelection,
  details: SearchFilters["sizeFilters"],
  query: string,
): string | null {
  // The family the user's mapped size values demand; query text is secondary
  // evidence ("chanel runners" → footwear) when the values are untyped.
  const typed = (details ?? []).find(
    (d) =>
      d.type &&
      size.mappedUserValues.some((v) => v.toLowerCase() === d.value.toLowerCase()),
  );
  const required: GarmentFamily | undefined =
    typed?.type ?? queryGarmentFamily(query);

  const nameFamily = categoryFamily(catalog.categoryName);
  if (nameFamily === null) {
    return `non-garment category "${catalog.categoryName}"`;
  }
  if (!required) return null; // untyped + neutral query → legacy behavior

  const ASPECT_FAMILY: Record<string, GarmentFamily> = {
    "US Shoe Size": "footwear",
    "EU Shoe Size": "footwear",
    "UK Shoe Size": "footwear",
    "Waist Size": "waist",
  };
  const aspectFamily = ASPECT_FAMILY[size.aspectName];
  if (aspectFamily) {
    return aspectFamily === required
      ? null
      : `aspect "${size.aspectName}" is ${aspectFamily}, filter is ${required}`;
  }
  // Generic "Size": the category must CONFIRM the family — by its name, by
  // the family-specific aspects it exposes alongside, or (only when the name
  // is UNKNOWN, e.g. the dominant-category path carries no name) by the query
  // text itself: "patagonia jacket"'s dominant category is a jacket category.
  // A KNOWN non-matching name is never overridden — "Women's Bags & Handbags"
  // stays rejected no matter what the query says.
  const confirmed =
    nameFamily === required ||
    aspectImpliedFamily(catalog) === required ||
    (nameFamily === undefined && queryGarmentFamily(query) === required);
  return confirmed
    ? null
    : `generic Size aspect in unconfirmed category "${catalog.categoryName ?? catalog.categoryId}" (needs ${required})`;
}

/**
 * Which filters were applied AT EBAY for this request. The engine skips these
 * locally — critical for sizes/colors, where item_summary lacks the fields the
 * local pass would check (the old silent-deletion bug).
 */
function sourceAppliedFilters(
  f: SearchFilters,
  plan: AspectPlan | null,
): (keyof SearchFilters)[] {
  const applied: (keyof SearchFilters)[] = [];
  if (f.minPrice !== undefined) applied.push("minPrice");
  if (f.maxPrice !== undefined) applied.push("maxPrice");
  // conditions deliberately NOT declared: eBay's conditions enum filter is
  // LOOSE (USED_GOOD matches the whole pre-owned band, Excellent and Fair
  // included — verified in production). It is still sent as a source-side
  // NARROWER, but the engine's local pass does the exact enforcement, which is
  // safe because mapCondition speaks the app's own condition vocabulary.
  if (f.freeShipping) applied.push("freeShipping");
  if (f.trust?.length === 1 && f.trust[0] === "guarantee") applied.push("trust");
  // Brand rides in aspect_filter, which eBay only honors WITH category_ids —
  // so it is source-applied only when a category plan exists. Otherwise the
  // engine's local title-based brand pass stays active for eBay.
  if (f.brands?.length && plan?.length) applied.push("brands");
  // Every plan entry maps the active size/color dimensions by construction
  // (unusable entries are dropped; an empty plan short-circuits earlier).
  if (f.sizes?.length && plan?.length) applied.push("sizes");
  if (f.colors?.length && plan?.length) applied.push("colors");
  return applied;
}

/**
 * Builds the Browse API search URL. Exported (and pure) so the filter/sort
 * syntax can be unit-tested — eBay rejects malformed `filter` strings with 400.
 */
export function buildEbaySearchUrl(
  host: string,
  params: SearchParams,
  offset: number,
  limit: number,
  plan: { categoryId: string; size: AspectSelection | null; color: AspectSelection | null } | null = null,
): URL {
  const url = new URL(`${host}/buy/browse/v1/item_summary/search`);
  const f = params.filters;

  // eBay requires q, category_ids, or a filter — a bare browse isn't allowed.
  url.searchParams.set("q", params.query || "fashion");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  // ── source-side filters ──
  const filters: string[] = [];
  if (f.minPrice !== undefined || f.maxPrice !== undefined) {
    const lo = f.minPrice ?? 0;
    const hi = f.maxPrice;
    // eBay range syntax: [lo..hi] bounded, [lo..] open-ended.
    filters.push(hi !== undefined ? `price:[${lo}..${hi}]` : `price:[${lo}..]`);
    filters.push("priceCurrency:USD");
  }
  if (f.conditions?.length) {
    const enums = [...new Set(f.conditions.flatMap((c) => CONDITION_FILTER[c] ?? []))];
    if (enums.length) filters.push(`conditions:{${enums.join("|")}}`);
  }
  if (f.freeShipping) filters.push("maxDeliveryCost:0");
  // Delivery context: enables per-item qualifiedPrograms and is REQUIRED by
  // the Authenticity Guarantee filter. US-only (matches EBAY_US default).
  filters.push(`deliveryCountry:${US_DELIVERY_CONTEXT.country}`);
  filters.push(`deliveryPostalCode:${US_DELIVERY_CONTEXT.postalCode}`);
  // Source-side ONLY when `guarantee` is the sole trust signal — the group is
  // OR, so `guarantee,trusted` must not exclude trusted-seller listings that
  // lack the guarantee. Mixed selections filter locally in the engine.
  if (f.trust?.length === 1 && f.trust[0] === "guarantee") {
    filters.push("qualifiedPrograms:{AUTHENTICITY_GUARANTEE}");
  }
  if (filters.length) url.searchParams.set("filter", filters.join(","));

  // ── aspects (brand/size/color) — ONLY inside a category-scoped plan ──
  // eBay silently IGNORES aspect_filter without category_ids (verified in
  // production: Brand:{Patagonia} alone filters nothing), so aspects are sent
  // exclusively via the discovered category plan, all in one parameter:
  //   category_ids=95672&aspect_filter=categoryId:95672,Brand:{X},US Shoe Size:{10|10.5}
  // Without a plan, brand filtering stays LOCAL (title-based) — see
  // sourceAppliedFilters, which only declares what was truly sent.
  if (plan) {
    url.searchParams.set("category_ids", plan.categoryId);
    const aspectParts: string[] = [];
    if (f.brands?.length) aspectParts.push(`Brand:{${f.brands.join("|")}}`);
    if (plan.size)
      aspectParts.push(`${plan.size.aspectName}:{${plan.size.values.join("|")}}`);
    if (plan.color)
      aspectParts.push(`Color:{${plan.color.values.join("|")}}`);
    if (aspectParts.length) {
      url.searchParams.set(
        "aspect_filter",
        `categoryId:${plan.categoryId},${aspectParts.join(",")}`,
      );
    }
  }

  // ── source-side sort (eBay supports price asc/desc + newly listed) ──
  if (params.sort === "price_asc") url.searchParams.set("sort", "price");
  else if (params.sort === "price_desc") url.searchParams.set("sort", "-price");
  else if (params.sort === "newest") url.searchParams.set("sort", "newlyListed");
  // "recommended" / "best_match" → eBay's default relevance ordering.

  return url;
}

/** Best `/itm/` URL for a listing: eBay's own link, else the numeric legacy id. */
function listingUrlFor(item: EbayItemSummary): string {
  if (item.itemWebUrl) return item.itemWebUrl;
  // RESTful ids look like "v1|285123456789|0" — the middle segment is the
  // legacy numeric id that /itm/ expects.
  const legacy = item.legacyItemId ?? item.itemId.split("|")[1];
  return `https://www.ebay.com/itm/${legacy ?? item.itemId}`;
}

/** Aspect-derived context for mapping a page of results (see searchListings). */
export interface MapContext {
  /** eBay's own Brand aspect vocabulary for this query's category — matched
   *  against listing TITLES. Never carries active filter values. */
  brandVocab: string[];
}

const EMPTY_CTX: MapContext = { brandVocab: [] };

/** Maps a validated eBay item summary into the normalized Listing. */
export function mapEbayItem(item: EbayItemSummary, ctx: MapContext = EMPTY_CTX): Listing {
  const price = item.price?.value ?? 0;
  const shippingOpt = item.shippingOptions?.[0];
  const shipping = shippingOpt?.shippingCost?.value;
  // "CALCULATED" shipping with no amount means unknown, not free.
  const shippingKnown = shipping !== undefined && shipping !== null;

  const images = [
    item.image?.imageUrl,
    ...(item.additionalImages ?? []).map((i) => i.imageUrl),
  ]
    .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
    .map(upgradeEbayImage);

  const location = [item.itemLocation?.city, item.itemLocation?.country]
    .filter(Boolean)
    .join(", ");

  return {
    id: `ebay:${item.itemId}`,
    marketplace: "ebay",
    externalId: item.itemId,
    title: item.title,
    description: item.shortDescription ?? undefined,
    // Brand: eBay's own vocabulary matched against the listing's title, then
    // the conservative known-brand fallback. Size only from the title's own
    // explicit pattern; color only from getItem detail. NEVER filter values.
    brand:
      brandFromVocabulary(item.title, ctx.brandVocab) ?? extractBrand(item.title),
    category: item.categories?.[0]?.categoryName ?? undefined,
    size: extractSize(item.title),
    condition: mapCondition(item.condition, item.conditionId),
    ...(item.qualifiedPrograms?.includes("AUTHENTICITY_GUARANTEE")
      ? {
          authenticated: true,
          authenticationSource: "ebay" as const,
          authenticationType: "authenticity_guarantee" as const,
        }
      : {}),
    price,
    shippingPrice: shippingKnown ? shipping : undefined,
    freeShipping: shippingKnown ? shipping === 0 : undefined,
    currency: item.price?.currency ?? "USD",
    imageUrls: images,
    listingUrl: listingUrlFor(item),
    sellerName: item.seller?.username ?? undefined,
    // feedbackPercentage is 0–100 → normalize to a 0–5 rating.
    sellerRating:
      item.seller?.feedbackPercentage != null
        ? Math.round((item.seller.feedbackPercentage / 20) * 10) / 10
        : undefined,
    // eBay's OFFICIAL Top Rated indicator (verified present on every summary
    // when the delivery context is sent) — the authoritative trusted-seller
    // signal, not a feedback heuristic.
    sellerVerified: item.topRatedBuyingExperience === true,
    location: location || undefined,
    listedAt: item.itemCreationDate ?? undefined,
  };
}

/* ───────────────────────── item detail mapping ───────────────────────── */

/**
 * Maps a getItem response into a ListingDetail.
 *
 * Field priority (per surface): confirmed structured eBay fields →
 * localizedAspects → conservative summary-style fallbacks → undefined.
 * Title parsing is used ONLY when no structured data exists at all — the
 * detail payload is the authoritative source here, not heuristics.
 */
export function mapEbayDetail(detail: EbayItemDetail): ListingDetail {
  const shipping = detail.shippingOptions?.[0]?.shippingCost?.value;
  const shippingKnown = shipping !== undefined && shipping !== null;
  const images = [
    detail.image?.imageUrl,
    ...(detail.additionalImages ?? []).map((i) => i.imageUrl),
  ]
    .filter((u): u is string => typeof u === "string" && u.startsWith("http"))
    .map(upgradeEbayImage);
  const location = [detail.itemLocation?.city, detail.itemLocation?.country]
    .filter(Boolean)
    .join(", ");

  const aspects = collectAspects(detail.localizedAspects);
  const category = detail.categoryPath?.split("|").pop() ?? undefined;
  const verifiedSize = parseVerifiedSize(aspects, category);

  // Ended or out-of-stock listings are honest "unavailable" states.
  const ended =
    detail.itemEndDate != null && new Date(detail.itemEndDate).getTime() < Date.now();
  const outOfStock = (detail.estimatedAvailabilities ?? []).some((a) =>
    /out_of_stock|ended/i.test(a.estimatedAvailabilityStatus ?? ""),
  );

  return {
    id: `ebay:${detail.itemId}`,
    marketplace: "ebay",
    externalId: detail.itemId,
    title: detail.title,
    description: detail.shortDescription ?? undefined,
    brand: detail.brand ?? aspect(aspects, "brand") ?? extractBrand(detail.title),
    category,
    size: verifiedSize?.value,
    verifiedSize,
    color: detail.color ?? aspect(aspects, "color", "colour"),
    material: detail.material ?? aspect(aspects, "material", "outer shell material"),
    gender: parseDepartment(aspects),
    condition: mapCondition(detail.condition, detail.conditionId),
    ...(detail.qualifiedPrograms?.includes("AUTHENTICITY_GUARANTEE")
      ? {
          authenticated: true,
          authenticationSource: "ebay" as const,
          authenticationType: "authenticity_guarantee" as const,
        }
      : {}),
    price: detail.price?.value ?? 0,
    shippingPrice: shippingKnown ? shipping : undefined,
    freeShipping: shippingKnown ? shipping === 0 : undefined,
    currency: detail.price?.currency ?? "USD",
    imageUrls: images,
    listingUrl:
      detail.itemWebUrl ??
      `https://www.ebay.com/itm/${detail.legacyItemId ?? detail.itemId.split("|")[1] ?? detail.itemId}`,
    sellerName: detail.seller?.username ?? undefined,
    sellerRating:
      detail.seller?.feedbackPercentage != null
        ? Math.round((detail.seller.feedbackPercentage / 20) * 10) / 10
        : undefined,
    sellerVerified:
      detail.seller?.feedbackPercentage != null &&
      detail.seller.feedbackPercentage >= 99 &&
      (detail.seller.feedbackScore ?? 0) >= 100,
    location: location || undefined,
    listedAt: detail.itemCreationDate ?? undefined,
    availability: ended || outOfStock ? "unavailable" : "active",
  };
}

