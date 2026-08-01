import { MockMarketplaceProvider } from "./mock";
import { fetchJson } from "./http";
import { grailedFeedSchema, grailedRawItemSchema, type GrailedRawItem } from "./schemas";
import { resolveFeed, type FeedConfig } from "./source";
import type {
  Listing,
  MarketplaceProvider,
  ProviderSearchResult,
  SearchParams,
} from "./types";

/**
 * Grailed provider.
 *
 * ── LEGAL NOTE ──────────────────────────────────────────────────────────────
 * Grailed has NO public API and its Terms of Service prohibit scraping. A
 * compliant production integration requires an APPROVED data partnership or a
 * licensed aggregator that already holds rights to Grailed inventory.
 *
 * The full live pipeline below (authenticated fetch → Zod validation → mapping)
 * activates when DATA_SOURCE=live and GRAILED_API_BASE + GRAILED_API_KEY are
 * set. Otherwise it serves mock data.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class GrailedProvider implements MarketplaceProvider {
  readonly marketplace = "grailed" as const;
  readonly isMock: boolean;

  private readonly config: FeedConfig;
  private readonly fallback = new MockMarketplaceProvider("grailed");

  constructor() {
    this.config = resolveFeed(
      "grailed",
      process.env.GRAILED_API_BASE,
      process.env.GRAILED_API_KEY,
    );
    this.isMock = this.config.mode === "mock";
  }

  /**
   * True source pagination with a SINGLE slicing layer.
   *
   * The engine merges/filters/sorts across marketplaces and slices the final
   * page itself, so this provider must return the cumulative result set for
   * engine pages 1..N — fetching only source page N here and letting the
   * engine slice again would double-paginate (the earlier "stuck at 22" bug).
   * Source pages 1..N are requested individually; Next's fetch cache
   * (revalidate: 60) makes pages 1..N-1 cache hits on each "Load more", so
   * every click costs one upstream request. `hasMore`/`sourceTotal` come from
   * the feed's real pagination metadata (Algolia nbHits) when available.
   */
  async searchListings(params: SearchParams): Promise<ProviderSearchResult> {
    if (this.config.mode === "mock" || !this.config.baseUrl) {
      return this.fallback.searchListings(params);
    }

    /* ── Authentication: NOT SUPPORTED by Grailed's search index ──
     * Verified against the live Algolia payload (all fields inspected):
     *   badges facet        → only "staff_pick" across broad + luxury queries
     *   hit.badges          → [] everywhere
     *   hit.strata          → listing tier (grailed/basic/hype), not auth
     *   hit.traits          → color / country_of_origin only
     *   user.*              → no auth fields (trusted-seller is explicitly
     *                         NOT authentication and is never used here)
     * Grailed authenticates at CHECKOUT for eligible purchases — there is no
     * listing-level authentication indicator to filter or badge on. So this
     * provider sits the filter out loudly rather than guessing.
     */
    // `trusted` IS supported (user.trusted_seller → sellerVerified, enforced
    // by the engine's local pass). A trust selection with no supported option
    // sits the search out loudly.
    const trust = params.filters.trust ?? [];
    if (trust.length > 0 && !trust.includes("trusted")) {
      return {
        listings: [],
        hasMore: false,
        sourceTotal: 0,
        unsupportedFilters: ["trust"],
      };
    }

    const pageSize = params.perPage;
    const all: GrailedRawItem[] = [];
    let sourceTotal: number | undefined;
    let nbPages: number | undefined;
    let lastPageLen = 0;
    let fetchedThrough = 0;
    let sourceFacets: ProviderSearchResult["sourceFacets"];

    for (let sourcePage = 1; sourcePage <= params.page; sourcePage += 1) {
      const url = this.buildSearchUrl(params, sourcePage, pageSize);
      const raw = await fetchJson(url, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        timeoutMs: 10000,
        retries: 2,
        revalidate: 60,
      });
      const feed = grailedFeedSchema.parse(raw);
      if (feed.total != null) sourceTotal = feed.total;
      if (feed.nbPages != null) nbPages = feed.nbPages;
      // Identical for every page of a query — keep the first set we see.
      if (feed.facets && !sourceFacets) {
        sourceFacets = feed.facets as ProviderSearchResult["sourceFacets"];
      }
      lastPageLen = feed.listings.length;
      fetchedThrough = sourcePage;
      all.push(...feed.listings);
      // Source ran dry before the requested depth — stop fetching.
      if (nbPages != null ? sourcePage >= nbPages : lastPageLen < pageSize) break;
    }

    // Dedupe across source pages (bumped listings can shift between pages).
    const seen = new Set<string>();
    const unique = all.filter((i) => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });

    // hasMore from the source's OWN pagination metadata when available — a
    // short page after filtering does NOT mean the source is exhausted.
    const hasMore =
      nbPages != null
        ? fetchedThrough < nbPages
        : sourceTotal !== undefined
          ? unique.length < sourceTotal && lastPageLen === pageSize
          : lastPageLen === pageSize;

    return {
      listings: unique.map(mapGrailedListing),
      hasMore,
      sourceTotal,
      sourceFacets,
      appliedFilters: sourceAppliedFilters(params.filters),
    };
  }

  private buildSearchUrl(params: SearchParams, page: number, pageSize: number): URL {
    const url = new URL(this.config.baseUrl!);
    const f = params.filters;
    url.searchParams.set("query", params.query);
    url.searchParams.set("page", String(page));
    url.searchParams.set("hits_per_page", String(pageSize));
    if (f.minPrice !== undefined) url.searchParams.set("price_min", String(f.minPrice));
    if (f.maxPrice !== undefined) url.searchParams.set("price_max", String(f.maxPrice));
    // Push the app's active filters into Grailed's own query (narrowed at the
    // source, not by trimming one local page). Remaining local-only filters:
    // color (Grailed exposes no color facet), free shipping, verified seller,
    // newly listed.
    if (f.brands?.length) url.searchParams.set("designers", f.brands.join(","));
    if (f.categories?.length) url.searchParams.set("categories", f.categories.join(","));
    if (f.conditions?.length) url.searchParams.set("conditions", f.conditions.join(","));
    // Typed tokens ("footwear:13") let the adapter scope the size facet to the
    // right garment family; untyped values keep the all-family behavior.
    if (f.sizes?.length) {
      const tokens =
        f.sizeFilters?.map((s) => (s.type ? `${s.type}:${s.value}` : s.value)) ??
        f.sizes;
      url.searchParams.set("sizes", tokens.join(","));
    }
    if (f.locations?.length) url.searchParams.set("locations", f.locations.join(","));
    const dept = f.genders?.find((g) => g !== "Unisex");
    if (dept) url.searchParams.set("department", dept);
    return url;
  }

  async getListing(externalId: string): Promise<Listing | null> {
    if (this.config.mode === "mock" || !this.config.baseUrl) {
      return this.fallback.getListing(externalId);
    }
    const url = new URL(
      `${this.config.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(externalId)}`,
    );
    try {
      const raw = await fetchJson(url, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        revalidate: 60,
      });
      const item = grailedRawItemSchema.parse(raw);
      return mapGrailedListing(item);
    } catch {
      return null;
    }
  }
}

/**
 * Which filters `buildSearchUrl` pushes to Grailed. Kept adjacent to that
 * method so the two can't drift — anything listed here is NOT re-filtered
 * locally by the engine.
 *
 * Deliberately excluded: colors (Grailed exposes no color facet), and
 * freeShipping / verifiedSeller / newlyListed (no source equivalent).
 */
function sourceAppliedFilters(f: SearchParams["filters"]): (keyof typeof f)[] {
  const applied: (keyof typeof f)[] = [];
  if (f.minPrice !== undefined) applied.push("minPrice");
  if (f.maxPrice !== undefined) applied.push("maxPrice");
  if (f.brands?.length) applied.push("brands");
  if (f.categories?.length) applied.push("categories");
  if (f.conditions?.length) applied.push("conditions");
  if (f.sizes?.length) applied.push("sizes");
  if (f.locations?.length) applied.push("locations");
  // Only pushed when a real department was selected (Unisex has no equivalent).
  if (f.genders?.some((g) => g !== "Unisex")) applied.push("genders");
  return applied;
}

/** Grailed department -> normalized gender. */
function mapGender(department?: string | null): Listing["gender"] {
  switch (department?.toLowerCase()) {
    case "menswear":
      return "Menswear";
    case "womenswear":
      return "Womenswear";
    default:
      return undefined;
  }
}

/** Maps a validated Grailed feed listing to the normalized Listing. */
export function mapGrailedListing(item: GrailedRawItem): Listing {
  const shipping = item.shipping?.us ?? 0;
  return {
    id: `grailed:${item.id}`,
    marketplace: "grailed",
    externalId: item.id,
    title: item.title,
    description: item.description ?? undefined,
    brand: item.designer_names?.[0],
    category: item.category_path?.[0],
    size: item.size ?? undefined,
    condition: item.condition as Listing["condition"],
    color: item.color ?? undefined,
    gender: mapGender(item.department),
    price: item.price,
    shippingPrice: shipping,
    freeShipping: shipping === 0,
    currency: item.currency,
    imageUrls: item.photos.map((p) => p.url),
    listingUrl: `https://www.grailed.com/listings/${item.id}`,
    sellerName: item.seller?.username ?? undefined,
    sellerRating: item.seller?.seller_score ?? undefined,
    sellerVerified: item.seller?.badges?.includes("trusted"),
    location: item.location ?? undefined,
    listedAt: item.created_at ?? undefined,
  };
}
