"use client";

import * as React from "react";
import type {
  EnrichedListing,
  Listing,
  ListingDetail,
  VerifiedListingSize,
} from "@/lib/marketplaces/types";
import { formatVerifiedSize } from "@/lib/marketplaces/size-string-parser";
import { parseSizeToken } from "@/lib/search/normalized-filters";

/**
 * Lazily enrich listings with VERIFIED detail fields (eBay getItem aspects)
 * the search feed omits.
 *
 * Fires ONLY when a detail surface (Quick View, Compare, detail page) shows
 * the listing — never during normal search browsing. Results are cached
 * client-side by id for the session (in memory — never local storage), and
 * the server caches + deduplicates getItem by item id underneath, so
 * reopening a listing or comparing after viewing costs nothing.
 */

interface DetailPatch {
  fields: Partial<Listing>;
  verifiedSize?: VerifiedListingSize;
  unavailable: boolean;
}

const clientCache = new Map<string, DetailPatch>();

/** Detail lookup is worthwhile only if a display field is actually absent. */
function needsEnrichment(listing: Listing): boolean {
  return (
    listing.marketplace === "ebay" &&
    (!listing.size || !listing.brand || !listing.color)
  );
}

/**
 * Only fields that ADD information — never overwrite feed data. The verified
 * size is NOT baked into `fields`: display formatting depends on the active
 * filter's preferred system, which can change while the cache entry lives, so
 * it is formatted at merge time instead.
 */
function toPatch(full: ListingDetail): DetailPatch {
  const fields: Partial<Listing> = {};
  if (full.availability === "active") {
    if (!full.verifiedSize && full.size) fields.size = full.size;
    if (full.brand) fields.brand = full.brand;
    if (full.color) fields.color = full.color;
    if (full.gender) fields.gender = full.gender;
    if (full.description) fields.description = full.description;
  }
  return {
    fields,
    verifiedSize: full.verifiedSize,
    unavailable: full.availability === "unavailable",
  };
}

/**
 * The size system the ACTIVE search filter asks for (e.g. footwear:39 → EU),
 * read from the URL at render time. Display preference only — never data.
 */
function preferredSystemFromUrl(): "US" | "EU" | "UK" | undefined {
  if (typeof window === "undefined") return undefined;
  const sizes = new URLSearchParams(window.location.search).get("sizes");
  for (const token of sizes?.split(",") ?? []) {
    const parsed = parseSizeToken(token.trim());
    if (parsed.system) return parsed.system;
  }
  return undefined;
}

/** Merge a patch into a listing, formatting the verified size for display. */
function applyPatch<T extends Listing>(listing: T, patch: DetailPatch): T {
  const merged = { ...listing, ...patch.fields };
  if (patch.verifiedSize && !patch.unavailable) {
    merged.size = formatVerifiedSize(patch.verifiedSize, preferredSystemFromUrl());
  }
  return merged;
}

function fetchPatch(
  listing: Listing,
  signal: AbortSignal,
): Promise<DetailPatch | null> {
  const cached = clientCache.get(listing.id);
  if (cached) return Promise.resolve(cached);
  return fetch(
    `/api/listings/${listing.marketplace}/${encodeURIComponent(listing.externalId)}`,
    { signal },
  )
    .then((res) => (res.ok ? (res.json() as Promise<ListingDetail>) : null))
    .then((full) => {
      if (!full) return null; // transient failure — keep summary, don't cache
      const patch = toPatch(full);
      clientCache.set(listing.id, patch);
      return patch;
    })
    .catch(() => null); // best-effort — the card already renders without it
}

export interface ListingDetailsState<T extends Listing> {
  /** The listing with verified fields merged in (summary data first, instantly). */
  listing: T | null;
  /** True while the detail request is in flight. */
  loading: boolean;
  /** True when the source reports the listing ended/removed. */
  unavailable: boolean;
  /** Structured verified size incl. the seller's raw string, for provenance UI. */
  verifiedSize?: VerifiedListingSize;
}

/** Enrich a single listing (Quick View / detail page). */
export function useListingDetails<T extends Listing>(
  source: T | null,
): ListingDetailsState<T> {
  const [patch, setPatch] = React.useState<DetailPatch | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setPatch(null);
    setLoading(false);
    if (!source || !needsEnrichment(source)) return;
    const cached = clientCache.get(source.id);
    if (cached) {
      setPatch(cached);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetchPatch(source, controller.signal)
      .then((p) => {
        if (controller.signal.aborted) return;
        if (p) setPatch(p);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [source?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source) return { listing: null, loading: false, unavailable: false };
  return {
    listing: patch ? applyPatch(source, patch) : source,
    loading,
    unavailable: patch?.unavailable ?? false,
    verifiedSize: patch?.verifiedSize,
  };
}

/** Enrich a set of listings while `enabled` (Compare drawer open). */
export function useListingsDetails<T extends Listing>(
  listings: T[],
  enabled: boolean,
): T[] {
  const [patches, setPatches] = React.useState<Record<string, DetailPatch>>({});
  const idsKey = listings.map((l) => l.id).join(",");

  React.useEffect(() => {
    if (!enabled) return;
    const targets = listings.filter(needsEnrichment);
    if (targets.length === 0) return;
    const controller = new AbortController();
    for (const listing of targets) {
      fetchPatch(listing, controller.signal).then((patch) => {
        if (patch && !controller.signal.aborted) {
          setPatches((prev) =>
            prev[listing.id] ? prev : { ...prev, [listing.id]: patch },
          );
        }
      });
    }
    return () => controller.abort();
  }, [enabled, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return listings.map((l) => (patches[l.id] ? applyPatch(l, patches[l.id]) : l));
}

// Re-export for consumers that need the enriched shape.
export type { EnrichedListing };
