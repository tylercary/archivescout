import { NextResponse } from "next/server";
import { getProviders } from "@/lib/marketplaces/registry";
import { EbayProvider, ebayDetailMetrics } from "@/lib/marketplaces/ebay";
import {
  MARKETPLACES,
  type ListingDetail,
  type Marketplace,
} from "@/lib/marketplaces/types";

/**
 * Single-listing detail lookup, used by Quick View / Compare / detail pages to
 * lazily enrich a card with VERIFIED fields the search feed omits (for eBay:
 * getItem's structured aspects — size with system, brand, color, department,
 * material).
 *
 * This is the ONLY place a per-item source request happens — never during a
 * normal search. Credentials stay server-side; providers cache by item id and
 * deduplicate concurrent lookups underneath. An ended/removed listing is a
 * 200 with `availability: "unavailable"` — a real, renderable state, not an
 * error.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { marketplace: string; externalId: string } },
): Promise<NextResponse> {
  const marketplace = params.marketplace as Marketplace;
  if (!(MARKETPLACES as readonly string[]).includes(marketplace)) {
    return NextResponse.json({ error: "Unknown marketplace" }, { status: 404 });
  }
  const externalId = decodeURIComponent(params.externalId);
  const provider = getProviders([marketplace])[0];

  // eBay: full detail path (verified aspects + availability + dedup/caching).
  if (provider instanceof EbayProvider) {
    const hitsBefore = ebayDetailMetrics.cacheHits;
    try {
      const detail = await provider.getListingDetail(externalId);
      const headers: Record<string, string> = {
        "cache-control": "private, max-age=300",
      };
      if (process.env.NODE_ENV !== "production") {
        headers["x-detail-cache"] =
          ebayDetailMetrics.cacheHits > hitsBefore ? "hit" : "miss";
      }
      return NextResponse.json(detail, { headers });
    } catch {
      // Transient upstream failure — let the client keep its summary data.
      return NextResponse.json({ error: "Detail temporarily unavailable" }, { status: 502 });
    }
  }

  // Other providers: plain lookup, always reported as active when found.
  if (!provider?.getListing) {
    return NextResponse.json(
      { error: "Marketplace does not support detail lookups" },
      { status: 404 },
    );
  }
  const listing = await provider.getListing(externalId);
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  const detail: ListingDetail = { ...listing, availability: "active" };
  return NextResponse.json(detail, {
    headers: { "cache-control": "private, max-age=300" },
  });
}
