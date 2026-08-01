import {
  DEFAULT_PER_PAGE,
  parseSearchParams,
  toQueryString,
} from "@/lib/search/params";
import type { SearchFilters, SearchParams } from "@/lib/marketplaces/types";

/**
 * Saved-search serialization.
 *
 * There is deliberately NO competing format: a saved search is stored as the
 * same normalized state the URL already encodes, and restored through the same
 * parser the search page uses (`toQueryString` / `parseSearchParams`). That
 * guarantees a saved search restores byte-identically to what the user saw,
 * and that any future filter automatically works here too.
 *
 * What is stored: query, marketplaces, sort, and the normalized filter model
 * (department, category, brand, typed sizes, price, condition, color, trust…).
 *
 * What is NEVER stored: pagination (`page`/`perPage`), loaded listing ids,
 * eBay aspect syntax, Grailed facet syntax, or any provider continuation
 * state. Saved searches stay marketplace-neutral — providers translate at
 * query time, so a saved search keeps working when a provider's syntax
 * changes.
 */

/** The row shape persisted to `saved_searches` (DB column names). */
export interface SavedSearchPayload {
  query: string;
  marketplaces: string[];
  /** ArchiveScout's normalized filter model — never marketplace syntax. */
  filters: SearchFilters;
  sort: string;
}

/** Pagination is view state, never part of a saved search's identity. */
function withoutPagination(params: SearchParams): SearchParams {
  return { ...params, page: 1, perPage: DEFAULT_PER_PAGE };
}

/** Live search state → the payload stored in the database. */
export function toSavedSearchPayload(params: SearchParams): SavedSearchPayload {
  const { query, marketplaces, filters, sort } = withoutPagination(params);
  return {
    query,
    marketplaces: [...marketplaces].sort(),
    // Round-trip through the URL codec so what we persist is exactly what the
    // app can restore — no field can drift in only one direction.
    filters: parseSearchParams(
      new URLSearchParams(toQueryString({ query, marketplaces, filters, sort, page: 1, perPage: DEFAULT_PER_PAGE })),
    ).filters,
    sort,
  };
}

/** Stored payload → the query string that restores the search. */
export function toSearchQueryString(payload: SavedSearchPayload): string {
  return toQueryString(fromSavedSearchPayload(payload));
}

/** Stored payload → the full URL to run the search. */
export function toSearchUrl(payload: SavedSearchPayload): string {
  const qs = toSearchQueryString(payload);
  return qs ? `/search?${qs}` : "/search";
}

/** Stored payload → live search state (page 1, default page size). */
export function fromSavedSearchPayload(payload: SavedSearchPayload): SearchParams {
  // Re-parse rather than trusting the stored JSON shape: the row may predate a
  // schema change, and the parser is the single place that validates/normalizes.
  return parseSearchParams(
    new URLSearchParams(
      toQueryString({
        query: payload.query,
        marketplaces: payload.marketplaces as SearchParams["marketplaces"],
        filters: payload.filters,
        sort: payload.sort as SearchParams["sort"],
        page: 1,
        perPage: DEFAULT_PER_PAGE,
      }),
    ),
  );
}

/**
 * Stable identity of a search, used to detect duplicates.
 *
 * Two searches are the same only when query, marketplaces, sort AND every
 * filter match — so "chanel runners", "+ size 13", and "+ size 13 +
 * authenticated" are three distinct saved searches. Derived from the canonical
 * query string with params sorted, so key order can never cause a false miss.
 */
export function searchIdentity(payload: SavedSearchPayload): string {
  const sp = new URLSearchParams(toSearchQueryString(payload));
  const entries = [...sp.entries()].sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

/** Do two saved searches represent the same search? */
export function isSameSearch(a: SavedSearchPayload, b: SavedSearchPayload): boolean {
  return searchIdentity(a) === searchIdentity(b);
}

/* ─────────────────────────── human summary ─────────────────────────── */

const MARKETPLACE_NAMES: Record<string, string> = {
  ebay: "eBay",
  grailed: "Grailed",
};

const TRUST_NAMES: Record<string, string> = {
  authenticated: "Marketplace authenticated",
  guarantee: "Authenticity Guarantee",
  trusted: "Trusted seller",
};

const SORT_NAMES: Record<string, string> = {
  recommended: "Recommended",
  best_match: "Best match",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  newest: "Newest",
};

const SIZE_TYPE_NAMES: Record<string, string> = {
  footwear: "Shoe size",
  waist: "Waist",
  clothing: "Size",
};

const money = (n: number) => `$${n.toLocaleString()}`;

/**
 * Readable summary rows for the save dialog and saved-search cards.
 * Deliberately speaks the user's language — never raw filter keys, never
 * marketplace syntax.
 */
export function describeSearch(
  payload: SavedSearchPayload,
): { label: string; value: string }[] {
  const f = payload.filters;
  const rows: { label: string; value: string }[] = [];

  rows.push({ label: "Query", value: payload.query || "All listings" });
  rows.push({
    label: "Marketplaces",
    value:
      payload.marketplaces.map((m) => MARKETPLACE_NAMES[m] ?? m).join(", ") ||
      "All",
  });

  if (f.genders?.length) rows.push({ label: "Department", value: f.genders.join(", ") });
  if (f.categories?.length) rows.push({ label: "Category", value: f.categories.join(", ") });
  if (f.brands?.length) rows.push({ label: "Brand", value: f.brands.join(", ") });

  if (f.sizeFilters?.length) {
    // Group typed sizes by family so the summary reads "Shoe size: US 13".
    const byType = new Map<string, string[]>();
    for (const s of f.sizeFilters) {
      const label = SIZE_TYPE_NAMES[s.type ?? ""] ?? "Size";
      const value = s.system ? `${s.system} ${s.value}` : s.value;
      byType.set(label, [...(byType.get(label) ?? []), value]);
    }
    for (const [label, values] of byType) {
      rows.push({ label, value: values.join(", ") });
    }
  } else if (f.sizes?.length) {
    rows.push({ label: "Size", value: f.sizes.join(", ") });
  }

  if (f.minPrice !== undefined || f.maxPrice !== undefined) {
    const value =
      f.minPrice !== undefined && f.maxPrice !== undefined
        ? `${money(f.minPrice)} – ${money(f.maxPrice)}`
        : f.maxPrice !== undefined
          ? `Under ${money(f.maxPrice)}`
          : `Over ${money(f.minPrice!)}`;
    rows.push({ label: "Price", value });
  }

  if (f.conditions?.length) rows.push({ label: "Condition", value: f.conditions.join(", ") });
  if (f.colors?.length) rows.push({ label: "Color", value: f.colors.join(", ") });
  if (f.locations?.length) rows.push({ label: "Location", value: f.locations.join(", ") });
  if (f.trust?.length) {
    rows.push({
      label: "Trust",
      value: f.trust.map((t) => TRUST_NAMES[t] ?? t).join(", "),
    });
  }
  if (f.freeShipping) rows.push({ label: "Shipping", value: "Free shipping only" });

  rows.push({ label: "Sort", value: SORT_NAMES[payload.sort] ?? payload.sort });
  return rows;
}

/**
 * Default name for a new saved search: the query in title case, plus the one
 * or two most distinguishing refinements ("Carhartt Double Knee · Waist 34").
 */
export function defaultSearchName(payload: SavedSearchPayload): string {
  const titleCase = (s: string) =>
    s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  const base = payload.query ? titleCase(payload.query) : "All listings";

  const f = payload.filters;
  const bits: string[] = [];
  if (f.sizeFilters?.length) {
    const s = f.sizeFilters[0];
    bits.push(s.system ? `${s.system} ${s.value}` : `Size ${s.value}`);
  } else if (f.sizes?.length) {
    bits.push(`Size ${f.sizes[0]}`);
  }
  if (f.maxPrice !== undefined) bits.push(`Under ${money(f.maxPrice)}`);
  else if (f.trust?.length) bits.push(TRUST_NAMES[f.trust[0]] ?? "Trusted");

  return [base, ...bits.slice(0, 1)].join(" · ").slice(0, 80);
}
