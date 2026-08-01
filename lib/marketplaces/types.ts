/**
 * Shared marketplace domain model.
 *
 * Every provider (eBay, Grailed, Mock) normalizes its raw API/feed
 * response into the `Listing` shape below. Nothing downstream — search engine,
 * API route, or UI — should ever depend on a marketplace's raw payload.
 */

export const MARKETPLACES = ["ebay", "grailed"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  ebay: "eBay",
  grailed: "Grailed",
};

export const CONDITIONS = [
  "New with tags",
  "New without tags",
  "Excellent",
  "Good",
  "Fair",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const GENDERS = ["Menswear", "Womenswear", "Unisex"] as const;
export type Gender = (typeof GENDERS)[number];

export const SORT_OPTIONS = [
  "recommended",
  "price_asc",
  "price_desc",
  "newest",
  "best_match",
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortOption, string> = {
  recommended: "Relevance",
  price_asc: "Price: Low → High",
  price_desc: "Price: High → Low",
  newest: "Newest",
  best_match: "Best match",
};

/** The sort options offered in the UI, in order. `best_match` stays a valid
 *  URL value (shareable links keep working) but is folded into Relevance. */
export const VISIBLE_SORT_OPTIONS: SortOption[] = [
  "recommended",
  "newest",
  "price_asc",
  "price_desc",
];

/** The normalized listing shared across every marketplace. */
export interface Listing {
  id: string; // globally unique within ArchiveScout: `${marketplace}:${externalId}`
  marketplace: Marketplace;
  externalId: string; // the marketplace's own id
  title: string;
  brand?: string;
  category?: string;
  size?: string;
  /** True ONLY when the marketplace's official program covers this listing. */
  authenticated?: boolean;
  authenticationSource?: AuthenticationSource;
  authenticationType?: AuthenticationType;
  condition?: Condition;
  color?: string;
  gender?: Gender;
  price: number;
  shippingPrice?: number;
  currency: string; // ISO 4217, e.g. "USD"
  imageUrls: string[];
  listingUrl: string;
  description?: string;
  sellerName?: string;
  sellerRating?: number; // 0–5
  sellerVerified?: boolean;
  freeShipping?: boolean;
  location?: string;
  listedAt?: string; // ISO 8601
}

/**
 * A Listing with derived, presentation-ready fields computed once by the
 * search engine so the UI never recomputes them.
 */
export interface EnrichedListing extends Listing {
  totalPrice: number; // price + (shippingPrice ?? 0)
  isFreeShipping: boolean;
}

/** Parameters accepted by every provider's `searchListings`. */
export interface SearchParams {
  query: string;
  marketplaces: Marketplace[];
  filters: SearchFilters;
  sort: SortOption;
  page: number;
  perPage: number;
}

/** All user-facing filters. Everything optional so URLs stay minimal. */
/* ─────────────── normalized, marketplace-neutral filter model ───────────────
 * The frontend emits these; each provider translates them into its own
 * source-side syntax (Grailed category_size facets, eBay category aspects).
 * Nothing marketplace-specific may appear here.
 */

/** What kind of size a value is — resolves "13 the shoe" vs "13 the waist". */
export interface NormalizedSizeFilter {
  /** The size label as the user picked it, e.g. "13", "34", "l". */
  value: string;
  /** Garment family, when known (the size UI knows which scale it rendered). */
  type?: "footwear" | "waist" | "clothing";
  /** Sizing system for footwear numerics, inferred conservatively. */
  system?: "US" | "EU" | "UK";
}

/** The full marketplace-neutral filter model (spec shape). `departments`
 *  mirrors `genders`, `sizes` carries the typed model. */
export interface NormalizedSearchFilters {
  departments?: string[];
  categories?: string[];
  brands?: string[];
  sizes?: NormalizedSizeFilter[];
  conditions?: string[];
  colors?: string[];
  minPrice?: number;
  maxPrice?: number;
}

/** A size verified from a listing's OWN detail data — never from a filter. */
export interface VerifiedListingSize {
  /** Clean primary value, e.g. "8". */
  value: string;
  type: "footwear" | "waist" | "clothing";
  system?: "US" | "EU" | "UK";
  source: "ebay_detail";
  /** The seller's original string when it needed cleaning ("EUR39=US8"). */
  rawValue?: string;
  /** Other sizes EXPLICITLY present in the source — never converted/invented. */
  alternatives?: { value: string; system?: "US" | "EU" | "UK" }[];
}

/**
 * Full listing detail, served by /api/listings/[marketplace]/[externalId].
 * `availability` is explicit so ended/removed listings render an honest state
 * instead of a broken link.
 */
/**
 * Trust filter options. `authenticated` and `guarantee` are AUTHENTICATION
 * (the item was verified); `trusted` is SELLER reputation — deliberately a
 * separate dimension, never a proxy for authentication.
 */
export const TRUST_OPTIONS = ["authenticated", "guarantee", "trusted"] as const;
export type TrustOption = (typeof TRUST_OPTIONS)[number];

/** Marketplace-neutral authentication provenance (see docs/INTEGRATION.md). */
export type AuthenticationSource = "grailed" | "ebay" | "therealreal" | "vestiaire";
export type AuthenticationType =
  | "marketplace_authentication"
  | "authenticity_guarantee"
  | "third_party";

export interface ListingDetail extends Listing {
  availability: "active" | "unavailable";
  verifiedSize?: VerifiedListingSize;
  material?: string;
}

export interface SearchFilters {
  minPrice?: number;
  maxPrice?: number;
  /**
   * Trust signals the listing must carry. OR within the group (standard facet
   * semantics): `["guarantee","trusted"]` = covered by a guarantee OR sold by
   * a trusted seller. Empty/absent = no trust constraint.
   */
  trust?: TrustOption[];
  /** Bare size labels ("13", "l") — what local matching and facets use. */
  sizes?: string[];
  /** Typed counterparts of `sizes`, parallel where classification is known.
   *  Providers use these to scope size filtering to the right garment family. */
  sizeFilters?: NormalizedSizeFilter[];
  brands?: string[];
  categories?: string[];
  conditions?: Condition[];
  colors?: string[];
  genders?: Gender[];
  locations?: string[];
  freeShipping?: boolean;
  verifiedSeller?: boolean;
  newlyListed?: boolean; // listed within the last 7 days
}

/** What a provider returns for one search: listings + source pagination hints. */
export interface ProviderSearchResult {
  listings: Listing[];
  /** True when the source can supply more results beyond what was returned. */
  hasMore?: boolean;
  /** The source's own total hit count for this query, when it reports one. */
  sourceTotal?: number;
  /**
   * Facet counts covering the source's ENTIRE result set, not just the page
   * fetched. When present these are authoritative — deriving facets from the
   * loaded page alone makes a broad search look like it has almost no options.
   */
  sourceFacets?: Partial<SearchFacets>;
  /**
   * Filter keys this provider already applied AT THE SOURCE. The engine skips
   * them when filtering locally, because re-checking a source-applied filter
   * against a listing field can silently delete correct results whenever the
   * two vocabularies differ — e.g. category "Sneakers" is sent to Grailed,
   * which correctly returns items labelled "Lowtop Sneakers".
   */
  appliedFilters?: (keyof SearchFilters)[];
  /**
   * Filters the user requested that this provider CANNOT apply for the current
   * query (e.g. eBay size when the dominant category exposes no size aspect).
   * The provider excludes itself from the results rather than returning
   * unfiltered items, and the UI tells the user why — never a silent removal.
   */
  unsupportedFilters?: (keyof SearchFilters)[];
}

/** Per-marketplace outcome so the UI can show partial-failure notices. */
export interface MarketplaceStatus {
  marketplace: Marketplace;
  ok: boolean;
  count: number;
  usedMock: boolean;
  error?: string;
  /** Source-reported total hits for this query (true pagination metadata). */
  sourceTotal?: number;
  /** Source can supply more results beyond what was fetched so far. */
  hasMore?: boolean;
  /** In live mode, this marketplace has no connected live source and was
   *  skipped entirely (its demo data is NOT mixed into live results). */
  notConnected?: boolean;
  /** Active filters this marketplace could not apply — it sat out the search
   *  and the UI explains why (honest filtering, never silent removal). */
  unsupportedFilters?: (keyof SearchFilters)[];
}

/** The full, normalized response returned by the search engine + API route. */
export interface SearchResponse {
  listings: EnrichedListing[];
  total: number; // total after filtering, before pagination (loaded-so-far in live mode)
  page: number;
  perPage: number;
  query: string;
  marketplaces: Marketplace[];
  sort: SortOption;
  marketplaceStatus: MarketplaceStatus[];
  facets: SearchFacets;
  tookMs: number;
  /** At least one source can supply more results beyond what was fetched. */
  sourceHasMore: boolean;
  /** Sum of source-reported totals when EVERY searched source reported one;
   *  undefined otherwise (never display a fake total). */
  sourceTotal?: number;
  /** True when sourceTotal reflects the active filters (all filters were
   *  applied source-side). When false, the UI must not present sourceTotal as
   *  a filtered count — show "N matching listings loaded" instead. */
  sourceTotalReflectsFilters: boolean;
}

/** Aggregated filter facets computed from the merged result set. */
export interface SearchFacets {
  brands: FacetBucket[];
  sizes: FacetBucket[];
  categories: FacetBucket[];
  conditions: FacetBucket[];
  colors: FacetBucket[];
  genders: FacetBucket[];
  locations: FacetBucket[];
  priceRange: { min: number; max: number };
}

export interface FacetBucket {
  value: string;
  count: number;
  /**
   * Optional parent group supplied by the source (e.g. Grailed's
   * `category_path` prefix: "accessories.handle_bags" → "Accessories").
   * Far more reliable than inferring the hierarchy from the label alone.
   */
  group?: string;
}

/**
 * The single contract every marketplace integration implements.
 * `getListing` is optional — not every source supports single-item lookups.
 */
export interface MarketplaceProvider {
  readonly marketplace: Marketplace;
  /** True when this provider is returning mock data (no live credentials). */
  readonly isMock: boolean;
  searchListings(params: SearchParams): Promise<ProviderSearchResult>;
  getListing?(externalId: string): Promise<Listing | null>;
}
