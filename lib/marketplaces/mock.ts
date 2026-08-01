import { MOCK_LISTINGS } from "./mock-data";
import type {
  Listing,
  Marketplace,
  MarketplaceProvider,
  ProviderSearchResult,
  SearchParams,
} from "./types";

/**
 * Simulate network latency so loading states are visible in the demo.
 * Deterministic per-marketplace so behaviour is reproducible.
 */
const LATENCY_MS: Record<Marketplace, number> = {
  ebay: 260,
  grailed: 300,
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tokenize a query into meaningful lowercase terms. */
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Lightweight relevance score. A blank query matches everything (score 1) so
 * the homepage "featured" grid and empty search both have content.
 */
export function relevanceScore(listing: Listing, query: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 1;

  const haystack = [
    listing.title,
    listing.brand,
    listing.category,
    listing.color,
    listing.condition,
    listing.gender,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let matched = 0;
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      matched += 1;
      // Brand/title hits are weighted more heavily.
      if (listing.brand?.toLowerCase().includes(term)) score += 3;
      if (listing.title.toLowerCase().includes(term)) score += 2;
      score += 1;
    }
  }
  // Require at least one term to match for a non-empty query.
  return matched === 0 ? 0 : score;
}

/**
 * The mock provider. Backs the demo and serves as a fallback for live
 * providers that lack credentials. Filtering/sorting/pagination happen in the
 * search engine — here we only do query relevance, as a real API would.
 */
export class MockMarketplaceProvider implements MarketplaceProvider {
  readonly isMock = true;

  constructor(readonly marketplace: Marketplace) {}

  async searchListings(params: SearchParams): Promise<ProviderSearchResult> {
    await delay(LATENCY_MS[this.marketplace]);

    const listings = MOCK_LISTINGS.filter(
      (l) => l.marketplace === this.marketplace,
    )
      .map((listing) => ({ listing, score: relevanceScore(listing, params.query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.listing);

    // The full mock catalogue is returned at once — nothing more at the source.
    return { listings, hasMore: false, sourceTotal: listings.length };
  }

  async getListing(externalId: string): Promise<Listing | null> {
    await delay(80);
    return (
      MOCK_LISTINGS.find(
        (l) => l.marketplace === this.marketplace && l.externalId === externalId,
      ) ?? null
    );
  }
}
