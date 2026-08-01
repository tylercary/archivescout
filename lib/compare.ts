import type { Listing } from "@/lib/marketplaces/types";

export interface CompareHighlights {
  lowestPriceId?: string;
  lowestTotalId?: string;
  bestRatingId?: string;
  newestId?: string;
}

export function totalOf(l: Listing): number {
  return l.price + (l.shippingPrice ?? 0);
}

/** Determine which listing wins each compared dimension. Ties → first seen. */
export function computeHighlights(items: Listing[]): CompareHighlights {
  if (items.length === 0) return {};

  let lowestPrice = items[0];
  let lowestTotal = items[0];
  let bestRating: Listing | undefined;
  let newest: Listing | undefined;

  for (const l of items) {
    if (l.price < lowestPrice.price) lowestPrice = l;
    if (totalOf(l) < totalOf(lowestTotal)) lowestTotal = l;

    if (l.sellerRating !== undefined) {
      if (!bestRating || l.sellerRating > (bestRating.sellerRating ?? -1)) {
        bestRating = l;
      }
    }
    if (l.listedAt) {
      const t = new Date(l.listedAt).getTime();
      const bn = newest?.listedAt ? new Date(newest.listedAt).getTime() : -1;
      if (!newest || t > bn) newest = l;
    }
  }

  return {
    lowestPriceId: lowestPrice.id,
    lowestTotalId: lowestTotal.id,
    bestRatingId: bestRating?.id,
    newestId: newest?.id,
  };
}
