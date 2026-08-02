/**
 * Pure alert-detection rules.
 *
 * Kept free of I/O so the interesting cases — first sweep, repeat price,
 * second drop, currency change — are unit-testable without a database or a
 * live marketplace.
 */

export type AlertEventType = "new_listing" | "price_drop";

export interface SnapshotRow {
  marketplace: string;
  external_listing_id: string;
  last_price: number | null;
  currency: string;
  last_notified_price: number | null;
}

export interface SeenListing {
  marketplace: string;
  externalId: string;
  price: number;
  currency: string;
}

export interface DetectedEvent {
  type: AlertEventType;
  marketplace: string;
  externalId: string;
  previousPrice: number | null;
  currentPrice: number;
  currency: string;
  dedupeKey: string;
}

const key = (m: string, id: string) => `${m}:${id}`;

/**
 * Dedupe keys. The price is part of the price-drop key on purpose: a further
 * drop produces a different key (so it alerts), while the same price produces
 * the same key (so the unique index rejects it).
 */
export function newListingKey(searchId: string, m: string, id: string): string {
  return `${searchId}:new:${m}:${id}`;
}
export function priceDropKey(
  searchId: string,
  m: string,
  id: string,
  price: number,
): string {
  return `${searchId}:drop:${m}:${id}:${price}`;
}

export interface DetectionResult {
  events: DetectedEvent[];
  /** True when this search had no snapshots — baseline only, never notify. */
  baseline: boolean;
}

/**
 * Compare a fresh result set against stored snapshots.
 *
 * Rules:
 * - FIRST sweep (no snapshots at all) establishes a baseline and emits NOTHING.
 *   Otherwise enabling alerts on an existing search would email every result.
 * - A listing is new when its (marketplace, id) was never seen for this search.
 * - A price drop needs current < stored price, in the SAME currency, and a
 *   price we haven't already alerted on. Cross-currency comparison is skipped
 *   rather than guessed — a EUR/USD swap is not a discount.
 */
export function detectEvents(
  searchId: string,
  seen: SeenListing[],
  snapshots: SnapshotRow[],
  enabledTypes: readonly string[],
): DetectionResult {
  const baseline = snapshots.length === 0;
  if (baseline) return { events: [], baseline: true };

  const bySnapshot = new Map(
    snapshots.map((s) => [key(s.marketplace, s.external_listing_id), s]),
  );
  const wantNew = enabledTypes.includes("new_listings");
  const wantDrop = enabledTypes.includes("price_drops");
  const events: DetectedEvent[] = [];

  for (const listing of seen) {
    const prior = bySnapshot.get(key(listing.marketplace, listing.externalId));

    if (!prior) {
      if (wantNew) {
        events.push({
          type: "new_listing",
          marketplace: listing.marketplace,
          externalId: listing.externalId,
          previousPrice: null,
          currentPrice: listing.price,
          currency: listing.currency,
          dedupeKey: newListingKey(searchId, listing.marketplace, listing.externalId),
        });
      }
      continue;
    }

    if (!wantDrop) continue;
    if (prior.last_price == null) continue;
    // Never compare across currencies.
    if (prior.currency !== listing.currency) continue;
    if (!(listing.price < prior.last_price)) continue;
    // Already alerted at this price (or lower) — stay quiet.
    if (prior.last_notified_price != null && listing.price >= prior.last_notified_price)
      continue;

    events.push({
      type: "price_drop",
      marketplace: listing.marketplace,
      externalId: listing.externalId,
      previousPrice: prior.last_price,
      currentPrice: listing.price,
      currency: listing.currency,
      dedupeKey: priceDropKey(
        searchId,
        listing.marketplace,
        listing.externalId,
        listing.price,
      ),
    });
  }

  return { events, baseline: false };
}
