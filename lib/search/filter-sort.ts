import type {
  EnrichedListing,
  SearchFacets,
  SearchFilters,
  SortOption,
} from "@/lib/marketplaces/types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Returns true if a listing was created within the last 7 days of `now`. */
function isNewlyListed(listing: EnrichedListing, now: number): boolean {
  if (!listing.listedAt) return false;
  const t = new Date(listing.listedAt).getTime();
  return !Number.isNaN(t) && now - t <= SEVEN_DAYS_MS;
}

function includesCI(haystack: string[] | undefined, needle?: string): boolean {
  if (!needle) return false;
  return !!haystack?.some((h) => h.toLowerCase() === needle.toLowerCase());
}

/** Apply all active filters to the merged result set. */
export function applyFilters(
  listings: EnrichedListing[],
  filters: SearchFilters,
  now: number = Date.now(),
  /**
   * Per-marketplace set of filter keys already applied AT THE SOURCE. Those are
   * skipped here: re-checking a source-applied filter against a listing field
   * silently deletes correct results when the vocabularies differ (Grailed
   * answers a "Sneakers" category filter with items labelled "Lowtop
   * Sneakers"). Absent/empty ⇒ filter everything locally.
   */
  sourceApplied?: Map<string, Set<keyof SearchFilters>>,
): EnrichedListing[] {
  return listings.filter((l) => {
    const done = sourceApplied?.get(l.marketplace);
    const skip = (key: keyof SearchFilters) => done?.has(key) ?? false;
    // Price bounds apply to the ITEM price (matching what marketplaces filter
    // on server-side) — not price+shipping, which would silently disagree with
    // the source-side filter and starve narrow price windows.
    if (!skip("minPrice") && filters.minPrice !== undefined && l.price < filters.minPrice)
      return false;
    if (!skip("maxPrice") && filters.maxPrice !== undefined && l.price > filters.maxPrice)
      return false;

    if (!skip("sizes") && filters.sizes?.length && !includesCI(filters.sizes, l.size))
      return false;
    if (!skip("brands") && filters.brands?.length && !includesCI(filters.brands, l.brand))
      return false;
    if (
      !skip("categories") &&
      filters.categories?.length &&
      !includesCI(filters.categories, l.category)
    )
      return false;
    if (
      !skip("conditions") &&
      filters.conditions?.length &&
      !includesCI(filters.conditions, l.condition)
    )
      return false;
    if (filters.colors?.length && !includesCI(filters.colors, l.color))
      return false;
    if (!skip("genders") && filters.genders?.length && !includesCI(filters.genders, l.gender))
      return false;
    if (
      !skip("locations") &&
      filters.locations?.length &&
      !includesCI(filters.locations, l.location)
    )
      return false;

    // Trust: OR within the group, and skipped when the provider already
    // applied it at the source.
    if (!skip("trust") && filters.trust?.length) {
      const ok = filters.trust.some((option) => {
        if (option === "trusted") return l.sellerVerified === true;
        if (option === "guarantee")
          return l.authenticationType === "authenticity_guarantee";
        return l.authenticationType === "marketplace_authentication";
      });
      if (!ok) return false;
    }
    if (filters.freeShipping && !l.isFreeShipping) return false;
    if (filters.verifiedSeller && !l.sellerVerified) return false;
    if (filters.newlyListed && !isNewlyListed(l, now)) return false;

    return true;
  });
}

/** Sort listings by the chosen option. `relevance` is a Map of id → score. */
export function applySort(
  listings: EnrichedListing[],
  sort: SortOption,
  relevance?: Map<string, number>,
): EnrichedListing[] {
  const arr = [...listings];
  const time = (l: EnrichedListing) =>
    l.listedAt ? new Date(l.listedAt).getTime() : 0;
  const rel = (l: EnrichedListing) => relevance?.get(l.id) ?? 0;

  switch (sort) {
    case "price_asc":
      return arr.sort((a, b) => a.totalPrice - b.totalPrice);
    case "price_desc":
      return arr.sort((a, b) => b.totalPrice - a.totalPrice);
    case "newest":
      return arr.sort((a, b) => time(b) - time(a));
    case "best_match":
      return arr.sort((a, b) => rel(b) - rel(a));
    case "recommended":
    default:
      // Blend relevance, verified sellers, and seller rating for a curated feel.
      return arr.sort((a, b) => {
        const score = (l: EnrichedListing) =>
          rel(l) * 2 +
          (l.sellerVerified ? 1.5 : 0) +
          (l.sellerRating ?? 0) * 0.4;
        return score(b) - score(a);
      });
  }
}

/** Build filter facets (available values + counts) from the merged results. */
export function buildFacets(listings: EnrichedListing[]): SearchFacets {
  const bucket = (get: (l: EnrichedListing) => string | undefined) => {
    const counts = new Map<string, number>();
    for (const l of listings) {
      const v = get(l);
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };

  // Facet price range mirrors the filter semantics: item price, not total.
  const prices = listings.map((l) => l.price);
  return {
    brands: bucket((l) => l.brand),
    sizes: bucket((l) => l.size),
    categories: bucket((l) => l.category),
    conditions: bucket((l) => l.condition),
    colors: bucket((l) => l.color),
    genders: bucket((l) => l.gender),
    locations: bucket((l) => l.location),
    priceRange: {
      min: prices.length ? Math.floor(Math.min(...prices)) : 0,
      max: prices.length ? Math.ceil(Math.max(...prices)) : 0,
    },
  };
}
