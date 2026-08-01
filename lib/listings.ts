import { MOCK_LISTINGS } from "@/lib/marketplaces/mock-data";
import type { EnrichedListing, Listing } from "@/lib/marketplaces/types";

/** Add derived presentation fields to a raw listing. */
export function enrichListing(listing: Listing): EnrichedListing {
  const shipping = listing.shippingPrice ?? 0;
  return {
    ...listing,
    totalPrice: Math.round((listing.price + shipping) * 100) / 100,
    isFreeShipping: listing.freeShipping ?? shipping === 0,
  };
}

/**
 * A curated, marketplace-diverse selection for the homepage featured grid.
 * Interleaves marketplaces so the grid feels balanced.
 */
export function getFeaturedListings(limit = 8): EnrichedListing[] {
  const byMarket = {
    grailed: MOCK_LISTINGS.filter((l) => l.marketplace === "grailed"),
    ebay: MOCK_LISTINGS.filter((l) => l.marketplace === "ebay"),
  };
  const order = ["grailed", "ebay"] as const;
  const out: Listing[] = [];
  let i = 0;
  while (out.length < limit && i < 20) {
    for (const m of order) {
      const item = byMarket[m][i];
      if (item && out.length < limit) out.push(item);
    }
    i += 1;
  }
  return out.map(enrichListing);
}
