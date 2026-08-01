import { parseSizeToken, sizeTokenValue } from "./normalized-filters";
import { z } from "zod";
import {
  CONDITIONS,
  GENDERS,
  MARKETPLACES,
  SORT_OPTIONS,
  type Marketplace,
  type SearchFilters,
  type SearchParams,
  type SortOption,
  TRUST_OPTIONS,
  type TrustOption,
} from "@/lib/marketplaces/types";

export const DEFAULT_PER_PAGE = 24;

/** Zod schema validating a raw record of query params into a SearchParams. */
export const searchParamsSchema = z
  .object({
    q: z.string().trim().max(120).optional().default(""),
    markets: z.string().optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    sizes: z.string().optional(),
    brands: z.string().optional(),
    categories: z.string().optional(),
    conditions: z.string().optional(),
    colors: z.string().optional(),
    genders: z.string().optional(),
    locations: z.string().optional(),
    trust: z.string().optional(),
    auth: z.enum(["1", "true"]).optional(), // legacy: == trust=guarantee
    freeShipping: z.enum(["1", "true"]).optional(),
    verifiedSeller: z.enum(["1", "true"]).optional(),
    newlyListed: z.enum(["1", "true"]).optional(),
    sort: z.enum(SORT_OPTIONS).optional().default("recommended"),
    page: z.coerce.number().int().min(1).optional().default(1),
    perPage: z.coerce.number().int().min(1).max(96).optional().default(DEFAULT_PER_PAGE),
  })
  .transform((raw): SearchParams => {
    // Size tokens may carry a garment-family prefix ("footwear:13") from the
    // grouped size UI. `sizes` keeps BARE values (local matching, facets,
    // chips); `sizeFilters` keeps the typed model for provider-side scoping.
    const sizeTokens = splitList(raw.sizes);
    const filters: SearchFilters = {
      minPrice: raw.minPrice,
      maxPrice: raw.maxPrice,
      sizes: sizeTokens?.map(sizeTokenValue),
      sizeFilters: sizeTokens?.map(parseSizeToken),
      brands: splitList(raw.brands),
      categories: splitList(raw.categories),
      conditions: intersectList(raw.conditions, CONDITIONS),
      colors: splitList(raw.colors),
      genders: intersectList(raw.genders, GENDERS),
      locations: splitList(raw.locations),
      trust: parseTrust(raw.trust, raw.auth),
      freeShipping: toBool(raw.freeShipping),
      verifiedSeller: toBool(raw.verifiedSeller),
      newlyListed: toBool(raw.newlyListed),
    };

    return {
      query: raw.q ?? "",
      marketplaces: parseMarketplaces(raw.markets),
      filters: pruneFilters(filters),
      sort: raw.sort as SortOption,
      page: raw.page,
      perPage: raw.perPage,
    };
  });

/** `trust=guarantee,trusted` → validated options. Legacy `auth=1` → guarantee. */
function parseTrust(raw?: string, legacyAuth?: string): TrustOption[] | undefined {
  const items = (splitList(raw) ?? []).filter((v): v is TrustOption =>
    (TRUST_OPTIONS as readonly string[]).includes(v),
  );
  if (items.length === 0 && toBool(legacyAuth)) return ["guarantee"];
  return items.length ? items : undefined;
}

function splitList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function intersectList<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number][] | undefined {
  const items = splitList(value);
  if (!items) return undefined;
  const filtered = items.filter((v): v is T[number] =>
    (allowed as readonly string[]).includes(v),
  );
  return filtered.length ? filtered : undefined;
}

function toBool(value?: string): boolean | undefined {
  return value === "1" || value === "true" ? true : undefined;
}

function parseMarketplaces(value?: string): Marketplace[] {
  const items = splitList(value);
  if (!items) return [...MARKETPLACES];
  const valid = items.filter((v): v is Marketplace =>
    (MARKETPLACES as readonly string[]).includes(v),
  );
  return valid.length ? valid : [...MARKETPLACES];
}

/** Drop undefined/empty filter keys so downstream logic stays simple. */
function pruneFilters(filters: SearchFilters): SearchFilters {
  const out: SearchFilters = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val === undefined) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    (out as Record<string, unknown>)[key] = val;
  }
  return out;
}

/** Parse a URLSearchParams / plain record into validated SearchParams. */
export function parseSearchParams(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): SearchParams {
  const record: Record<string, string> = {};
  if (input instanceof URLSearchParams) {
    input.forEach((value, key) => {
      record[key] = value;
    });
  } else {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      record[key] = Array.isArray(value) ? value.join(",") : value;
    }
  }
  return searchParamsSchema.parse(record);
}

/**
 * Serialize SearchParams back into a URLSearchParams. Only non-default values
 * are written so shareable URLs stay clean.
 */
export function toQueryString(params: SearchParams): string {
  const sp = new URLSearchParams();
  if (params.query) sp.set("q", params.query);

  if (
    params.marketplaces.length &&
    params.marketplaces.length !== MARKETPLACES.length
  ) {
    sp.set("markets", params.marketplaces.join(","));
  }

  const f = params.filters;
  if (f.minPrice !== undefined) sp.set("minPrice", String(f.minPrice));
  if (f.maxPrice !== undefined) sp.set("maxPrice", String(f.maxPrice));
  if (f.sizes?.length) {
    // Re-emit the TYPED token ("footwear:13") — serializing the bare value
    // would strip the garment family on every client-side fetch.
    const tokens =
      f.sizeFilters?.map((s) => (s.type ? `${s.type}:${s.value}` : s.value)) ??
      f.sizes;
    sp.set("sizes", tokens.join(","));
  }
  if (f.brands?.length) sp.set("brands", f.brands.join(","));
  if (f.categories?.length) sp.set("categories", f.categories.join(","));
  if (f.conditions?.length) sp.set("conditions", f.conditions.join(","));
  if (f.colors?.length) sp.set("colors", f.colors.join(","));
  if (f.genders?.length) sp.set("genders", f.genders.join(","));
  if (f.locations?.length) sp.set("locations", f.locations.join(","));
  if (f.trust?.length) sp.set("trust", f.trust.join(","));
  if (f.freeShipping) sp.set("freeShipping", "1");
  if (f.verifiedSeller) sp.set("verifiedSeller", "1");
  if (f.newlyListed) sp.set("newlyListed", "1");

  if (params.sort && params.sort !== "recommended") sp.set("sort", params.sort);
  if (params.page > 1) sp.set("page", String(params.page));
  // Round-trip a non-default page size, otherwise a perPage in the URL is
  // parsed but silently dropped when the client calls /api/search.
  if (params.perPage !== DEFAULT_PER_PAGE) sp.set("perPage", String(params.perPage));

  return sp.toString();
}

/** Count of active filters, for badge display. */
export function countActiveFilters(filters: SearchFilters): number {
  let n = 0;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    // `sizeFilters` is a DERIVED parallel of `sizes` — counting both would
    // report "2 filters" for a single selected size.
    if (key === "sizeFilters") continue;
    if (Array.isArray(value)) n += value.length ? 1 : 0;
    else if (typeof value === "boolean") n += value ? 1 : 0;
    else n += 1;
  }
  return n;
}
