import { relevanceScore } from "@/lib/marketplaces/mock";
import { getProviders } from "@/lib/marketplaces/registry";
import type {
  EnrichedListing,
  Listing,
  MarketplaceStatus,
  SearchFacets,
  SearchParams,
  SearchResponse,
} from "@/lib/marketplaces/types";
import { dedupeListings } from "./dedupe";
import { expandQueryVariants } from "./query-variants";
import { enforceSizeInvariant } from "./size-invariant";
import { applyFilters, applySort, buildFacets } from "./filter-sort";

/**
 * Combine locally-derived facets (computed from the listings we actually
 * loaded) with facets a source reported for its ENTIRE result set.
 *
 * Source facets are authoritative for the dimensions they cover: they describe
 * every matching listing, whereas local counts only describe the current page.
 * Local values not present in the source list are appended, so marketplaces
 * that report no facets (mock, eBay) still contribute their options.
 */
function mergeFacets(
  local: SearchFacets,
  sources: Partial<SearchFacets>[],
): SearchFacets {
  if (sources.length === 0) return local;

  const dimensions = [
    "brands",
    "sizes",
    "categories",
    "conditions",
    "colors",
    "genders",
    "locations",
  ] as const;

  const merged: SearchFacets = { ...local };

  for (const dimension of dimensions) {
    const fromSources = new Map<string, number>();
    for (const source of sources) {
      for (const bucket of source[dimension] ?? []) {
        fromSources.set(
          bucket.value,
          (fromSources.get(bucket.value) ?? 0) + bucket.count,
        );
      }
    }
    if (fromSources.size === 0) continue;

    // Keep local-only values (other providers) that the source never reported.
    const seen = new Set(
      [...fromSources.keys()].map((v) => v.toLowerCase()),
    );
    for (const bucket of local[dimension] ?? []) {
      if (!seen.has(bucket.value.toLowerCase())) {
        fromSources.set(bucket.value, bucket.count);
      }
    }

    merged[dimension] = [...fromSources.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  // Widen the price range to cover whatever the sources reported.
  const ranges = sources.map((s) => s.priceRange).filter(Boolean);
  if (ranges.length > 0) {
    merged.priceRange = {
      min: Math.min(local.priceRange.min, ...ranges.map((r) => r!.min)),
      max: Math.max(local.priceRange.max, ...ranges.map((r) => r!.max)),
    };
  }

  return merged;
}

/** Compute derived, presentation-ready fields once. */
function enrich(listing: Listing): EnrichedListing {
  const shipping = listing.shippingPrice ?? 0;
  return {
    ...listing,
    totalPrice: Math.round((listing.price + shipping) * 100) / 100,
    isFreeShipping: listing.freeShipping ?? shipping === 0,
  };
}

/**
 * Orchestrates a cross-marketplace search:
 *   validate → fan out (allSettled) → normalize → merge → dedupe →
 *   filter → sort → paginate → respond (with per-marketplace status).
 *
 * Server-only. Called from the /api/search route.
 */
export async function runSearch(
  params: SearchParams,
  now: number = Date.now(),
): Promise<SearchResponse> {
  const startedAt = now;
  const requested = getProviders(params.marketplaces);

  // Marketplace accuracy: in live mode, a marketplace with no connected live
  // source is SKIPPED — its demo/mock listings are never mixed into real
  // results or counts. (Mock/sandbox modes search every requested provider.)
  const dataSource = (process.env.DATA_SOURCE ?? "mock").toLowerCase();
  const isLiveMode = dataSource === "live";
  const providers = isLiveMode ? requested.filter((p) => !p.isMock) : requested;
  const skipped = isLiveMode ? requested.filter((p) => p.isMock) : [];

  /* Conservative query variants ("chanel running" also searches "chanel
   * runner") — marketplaces stem differently, so each provider searches every
   * variant and the union is deduped by listing id (marketplace+externalId).
   * The ORIGINAL query stays canonical for display and relevance ranking.
   * expandQueryVariants caps the set, and most queries have no variants. */
  const variants = expandQueryVariants(params.query);

  /**
   * Search one provider across all query variants and merge into a single
   * ProviderSearchResult. Semantics of the merged metadata:
   * - sourceTotal: MAX across variants — result sets overlap heavily, so a
   *   sum would fabricate a bigger universe than exists; max is a true floor.
   * - sourceFacets: from the variant with the largest total (the dominant
   *   phrasing) — facet counts from overlapping sets must not be added.
   * - appliedFilters: INTERSECTION across variants that returned listings —
   *   a listing is only exempt from local re-filtering if ITS request truly
   *   applied the filter at the source. (Variants that applied nothing return
   *   zero listings, so they can't leak and don't veto the others.)
   * - unsupportedFilters: only when EVERY variant reported it.
   */
  const searchAllVariants = async (
    provider: (typeof providers)[number],
    depth: number,
  ) => {
    const settled = await Promise.allSettled(
      variants.map((q) =>
        provider.searchListings({ ...params, query: q, page: depth }),
      ),
    );
    const ok = settled
      .filter(
        (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof provider.searchListings>>> =>
          s.status === "fulfilled",
      )
      .map((s) => s.value);
    if (ok.length === 0) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    if (ok.length === 1 && variants.length === 1) return ok[0];

    const seen = new Set<string>();
    const listings: Listing[] = [];
    for (const r of ok) {
      for (const l of r.listings) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        listings.push(l);
      }
    }
    const withResults = ok.filter((r) => r.listings.length > 0);
    const pool = withResults.length ? withResults : ok;
    const applied = pool
      .map((r) => r.appliedFilters ?? [])
      .reduce((acc, cur) => acc.filter((k) => cur.includes(k)));
    const unsupported = (ok[0].unsupportedFilters ?? []).filter((k) =>
      ok.every((r) => r.unsupportedFilters?.includes(k)),
    );
    const totals = ok
      .map((r) => r.sourceTotal)
      .filter((n): n is number => n != null);
    const bestFacets = [...ok]
      .filter((r) => r.sourceFacets)
      .sort((a, b) => (b.sourceTotal ?? 0) - (a.sourceTotal ?? 0))[0]?.sourceFacets;

    return {
      listings,
      hasMore: ok.some((r) => r.hasMore),
      sourceTotal: totals.length ? Math.max(...totals) : undefined,
      sourceFacets: bestFacets,
      appliedFilters: applied,
      unsupportedFilters: unsupported.length ? unsupported : undefined,
    };
  };

  /**
   * Fan out to providers for source pages 1..depth, normalize, merge.
   * One provider failure never blocks the others.
   */
  const collect = async (depth: number) => {
    const settled = await Promise.allSettled(
      providers.map((p) => searchAllVariants(p, depth)),
    );

    const statuses: MarketplaceStatus[] = [];
    let merged: EnrichedListing[] = [];
    let hasMore = false;
    const sourceFacets: Partial<SearchFacets>[] = [];
    const sourceApplied = new Map<string, Set<keyof SearchParams["filters"]>>();

    settled.forEach((result, i) => {
      const provider = providers[i];
      if (result.status === "fulfilled") {
        // 3. Normalize → 4. merge. The size-family invariant runs HERE, on
        // every provider's results, before anything is counted or shown: a
        // typed size filter (footwear 13) removes listings whose own category
        // contradicts the family (a handbag can never be footwear-13), and
        // listings whose own size data contradicts the filter. Sources that
        // filter by GENERIC aspects (eBay "Size") need positive category
        // confirmation; family-scoped sources (Grailed category_size facets)
        // fail only on positive mismatch.
        const enriched = enforceSizeInvariant(
          result.value.listings.map(enrich),
          params.filters.sizeFilters ?? [],
          (l) => l.marketplace === "ebay",
        );
        merged = merged.concat(enriched);
        if (result.value.hasMore) hasMore = true;
        if (result.value.sourceFacets) sourceFacets.push(result.value.sourceFacets);
        sourceApplied.set(
          provider.marketplace,
          new Set(result.value.appliedFilters ?? []),
        );
        statuses.push({
          marketplace: provider.marketplace,
          ok: true,
          count: enriched.length,
          usedMock: provider.isMock,
          sourceTotal: result.value.sourceTotal,
          hasMore: result.value.hasMore,
          unsupportedFilters: result.value.unsupportedFilters,
        });
      } else {
        statuses.push({
          marketplace: provider.marketplace,
          ok: false,
          count: 0,
          usedMock: provider.isMock,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error",
        });
      }
    });

    for (const p of skipped) {
      statuses.push({
        marketplace: p.marketplace,
        ok: true,
        count: 0,
        usedMock: true,
        notConnected: true,
      });
    }

    return { merged, statuses, hasMore, sourceFacets, sourceApplied };
  };

  /**
   * Progressive filtered loading (fallback for LOCAL-ONLY filters — color,
   * free shipping, verified seller, newly listed; size/category/brand/
   * condition/price/gender/location are pushed to the source and don't need
   * it).  Grailed exposes no color facet, so color is the one visible filter
   * that can only be evaluated per-listing — deepening keeps it from showing a
   * starved page built from whatever a single source page happened to hold.
   *
   * A source page can be full while only a few items survive local filters.
   * Rather than showing a starved page, keep deepening — one extra source page
   * per iteration (earlier pages are fetch-cache hits) — until the requested
   * UI depth (page * perPage) is filled, the source is exhausted, or the
   * safety cap is reached. "Load more" naturally resumes deeper because every
   * request recomputes depth starting from params.page.
   */
  const MAX_EXTRA_SOURCE_PAGES = 4;
  let depth = params.page;
  let extraPages = 0;
  let {
    merged,
    statuses: marketplaceStatus,
    hasMore: sourceHasMore,
    sourceFacets,
    sourceApplied,
  } = await collect(depth);
  let filteredCount = applyFilters(dedupeListings(merged), params.filters, now, sourceApplied)
    .length;
  const needed = params.page * params.perPage;

  while (
    filteredCount < needed &&
    sourceHasMore &&
    extraPages < MAX_EXTRA_SOURCE_PAGES
  ) {
    extraPages += 1;
    depth += 1;
    ({
      merged,
      statuses: marketplaceStatus,
      hasMore: sourceHasMore,
      sourceFacets,
      sourceApplied,
    } = await collect(depth));
    filteredCount = applyFilters(dedupeListings(merged), params.filters, now, sourceApplied)
      .length;
  }

  // 5. Remove obvious duplicates across marketplaces.
  const deduped = dedupeListings(merged);

  // Facets are built from the deduped set BEFORE user filters so the sidebar
  // always shows every option available for this query. Where a source reports
  // facets for its FULL result set, those win — page-derived counts make a
  // broad search look like it has only a handful of sizes/brands.
  const facets = mergeFacets(buildFacets(deduped), sourceFacets);

  // Precompute relevance once for sorting (best_match / recommended).
  const relevance = new Map<string, number>();
  for (const l of deduped) relevance.set(l.id, relevanceScore(l, params.query));

  // 6. Apply filters → 7. Apply sorting
  const filtered = applyFilters(deduped, params.filters, now, sourceApplied);
  const sorted = applySort(filtered, params.sort, relevance);

  // Paginate. This is the ONLY slicing layer — providers return the
  // cumulative result set for pages 1..N and never pre-slice. The response is
  // CUMULATIVE (top page*perPage of the merged sort) rather than a lone slice:
  // deeper fetches can re-rank earlier items, so disjoint slices would overlap
  // or skip listings. The client renders the cumulative list directly.
  const total = sorted.length;
  const pageItems = sorted.slice(0, params.page * params.perPage);

  // Aggregate a true total ONLY when every searched (connected, successful)
  // marketplace reported one — otherwise leave it undefined (no fake totals).
  const connectedOk = marketplaceStatus.filter((s) => s.ok && !s.notConnected);
  const sourceTotal =
    connectedOk.length > 0 &&
    connectedOk.every((s) => s.sourceTotal !== undefined)
      ? connectedOk.reduce((sum, s) => sum + (s.sourceTotal ?? 0), 0)
      : undefined;

  // Does the source total reflect the ACTIVE filters? Only when every searched
  // source is live Grailed (which applies query/price/brand/category/condition/
  // size/gender source-side) and no local-only filter is active. Otherwise the
  // UI must not present sourceTotal as a filtered count.
  const f = params.filters;
  const hasLocalOnlyFilters = Boolean(
    f.colors?.length ||
      f.freeShipping ||
      f.verifiedSeller ||
      f.newlyListed,
  );
  const sourceTotalReflectsFilters =
    providers.length > 0 &&
    providers.every((p) => p.marketplace === "grailed" && !p.isMock) &&
    !hasLocalOnlyFilters;

  // Dev-only diagnostics, one compact line per search. Set SEARCH_DEBUG=verbose
  // for the full object (active filters, source-side vs local-only breakdown).
  if (process.env.NODE_ENV !== "production") {
    const activeKeys = Object.keys(params.filters);
    const flow = `raw ${merged.length}→dedupe ${deduped.length}→filter ${total}→page ${pageItems.length}`;
    const totalStr = sourceTotal !== undefined ? `~${sourceTotal}` : "unknown";
    // eslint-disable-next-line no-console
    console.log(
      `[search] "${params.query}" p${params.page}` +
        (extraPages ? ` (depth ${depth}, +${extraPages})` : "") +
        ` | ${flow} | total ${totalStr}${sourceTotalReflectsFilters ? "" : " (unfiltered)"}` +
        `${sourceHasMore ? " | more" : ""}` +
        (activeKeys.length ? ` | filters: ${activeKeys.join(",")}` : ""),
    );
    if (process.env.SEARCH_DEBUG === "verbose") {
      // eslint-disable-next-line no-console
      console.log("[search:verbose]", {
        activeFilters: params.filters,
        sourceSideFilters: ["query", "minPrice", "maxPrice", "brands", "categories", "conditions", "sizes", "genders", "locations"],
        localOnlyFilters: ["colors", "freeShipping", "verifiedSeller", "newlyListed"],
        requestedPage: params.page,
        sourceDepthFetched: depth,
        extraSourcePages: extraPages,
        sourceHasMore,
        sourceTotal,
        sourceTotalReflectsFilters,
        // Which filters each provider reported as already applied at the
        // source — the set the local pass deliberately skips.
        appliedAtSource: Object.fromEntries(
          [...sourceApplied].map(([m, keys]) => [m, [...keys]]),
        ),
      });
    }
  }

  return {
    listings: pageItems,
    total,
    page: params.page,
    perPage: params.perPage,
    query: params.query,
    marketplaces: params.marketplaces,
    sort: params.sort,
    marketplaceStatus,
    facets,
    tookMs: Date.now() - startedAt,
    sourceHasMore,
    sourceTotal,
    sourceTotalReflectsFilters,
  };
}
