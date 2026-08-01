import type { EnrichedListing, Listing } from "@/lib/marketplaces/types";

/** Normalize a title for comparison: lowercase, strip punctuation/emoji, collapse space. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|for|with|in|size|mens|womens)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token set (Jaccard) similarity between two normalized strings, 0–1. */
export function tokenSimilarity(a: string, b: string): number {
  const sa = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const sb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection += 1;
  const union = sa.size + sb.size - intersection;
  return intersection / union;
}

/**
 * Decide whether two listings are likely the SAME physical item cross-posted
 * to multiple marketplaces. Conservative by design — we only flag duplicates
 * with strong evidence, per the product spec.
 */
export function isLikelyDuplicate(a: Listing, b: Listing): boolean {
  // Duplicates mean the SAME item cross-posted to DIFFERENT marketplaces. Two
  // listings on the same marketplace are distinct items from distinct sellers,
  // even when they look alike. Marketplaces with generic, auto-generated
  // titles can make distinct listings look identical, so comparing them here
  // would silently delete real results.
  if (a.marketplace === b.marketplace) return false;

  // Same image URL is near-certain evidence of a cross-post.
  const sharedImage = a.imageUrls.some((u) => b.imageUrls.includes(u));

  const titleSim = tokenSimilarity(a.title, b.title);
  const sameBrand =
    !!a.brand && !!b.brand && a.brand.toLowerCase() === b.brand.toLowerCase();
  const sameSize =
    !a.size || !b.size
      ? true // missing size shouldn't block a strong title+brand match
      : a.size.toLowerCase() === b.size.toLowerCase();

  const priceClose =
    Math.abs(a.price - b.price) <= Math.max(10, a.price * 0.1);

  if (sharedImage && titleSim >= 0.5) return true;

  // Strong textual match: very similar title + same brand + same size + close price.
  return titleSim >= 0.82 && sameBrand && sameSize && priceClose;
}

/**
 * Remove duplicates from a merged, cross-marketplace result set.
 * Keeps the lowest total-price copy of each duplicate cluster.
 */
export function dedupeListings(listings: EnrichedListing[]): EnrichedListing[] {
  const kept: EnrichedListing[] = [];

  for (const listing of listings) {
    const dupIndex = kept.findIndex((k) => isLikelyDuplicate(k, listing));
    if (dupIndex === -1) {
      kept.push(listing);
      continue;
    }
    // Keep whichever is cheaper overall.
    if (listing.totalPrice < kept[dupIndex].totalPrice) {
      kept[dupIndex] = listing;
    }
  }

  return kept;
}
