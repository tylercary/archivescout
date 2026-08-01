import type {
  EnrichedListing,
  Listing,
  Marketplace,
  SearchFilters,
  SortOption,
} from "@/lib/marketplaces/types";

/** A favorited listing. We store the full snapshot so saved items render
 *  even if the source listing later disappears from search. */
export interface FavoriteItem {
  listing: Listing;
  savedAt: string; // ISO
}

/** A saved search the user can re-run and (optionally) get price alerts for. */
export interface SavedSearch {
  id: string;
  query: string;
  marketplaces: Marketplace[];
  filters: SearchFilters;
  sort: SortOption;
  maxDesiredPrice?: number;
  priceAlert: boolean;
  createdAt: string; // ISO
}

/** A recent (unsaved) search kept locally for quick re-runs. */
export interface RecentSearch {
  query: string;
  marketplaces: Marketplace[];
  at: string; // ISO
}

export type { EnrichedListing, Listing };
