import type {
  NormalizedSearchFilters,
  NormalizedSizeFilter,
  SearchFilters,
} from "@/lib/marketplaces/types";
import { sizeFamily, type SizeFamily } from "./taxonomy";

/**
 * The marketplace-neutral filter model and its URL codec.
 *
 * The size UI renders one size scale at a time, so at click time the family
 * ("footwear" vs "waist" vs "clothing") is KNOWN — this module carries that
 * knowledge through the URL as a `family:value` token (e.g. `footwear:13`)
 * so providers can scope size filtering to the right garment family instead
 * of guessing what "13" means. Bare values remain fully supported: old URLs,
 * saved searches, and hand-typed params behave exactly as before.
 */

/* ─────────────────────────── size-token codec ─────────────────────────── */

const SIZE_TYPES = ["footwear", "waist", "clothing"] as const;
type SizeType = (typeof SIZE_TYPES)[number];

/** Taxonomy family (UI grouping) → neutral size type. */
const FAMILY_TO_TYPE: Partial<Record<SizeFamily, SizeType>> = {
  footwear: "footwear",
  bottoms: "waist",
  tops: "clothing",
};

/** Encode a size chosen inside a UI size-scale group into its URL token. */
export function makeSizeToken(family: SizeFamily | undefined, value: string): string {
  const type = family ? FAMILY_TO_TYPE[family] : undefined;
  return type ? `${type}:${value}` : value;
}

/** The bare size label of a token — what chips display and facets match on. */
export function sizeTokenValue(token: string): string {
  const i = token.indexOf(":");
  if (i === -1) return token;
  const prefix = token.slice(0, i);
  return (SIZE_TYPES as readonly string[]).includes(prefix)
    ? token.slice(i + 1)
    : token;
}

/**
 * Conservative sizing-system inference for footwear numerics: EU sizes live
 * in 33–54, US in 3–18 (the EBAY_US default). Overlap is impossible, so this
 * never guesses wrong — anything else stays undefined.
 */
function inferSystem(type: SizeType | undefined, value: string): "US" | "EU" | undefined {
  if (type !== "footwear") return undefined;
  const n = /^\d{1,2}(?:\.5)?$/.test(value) ? parseFloat(value) : null;
  if (n === null) return undefined;
  if (n >= 33 && n <= 54) return "EU";
  if (n >= 3 && n <= 18) return "US";
  return undefined;
}

/**
 * Decode one URL size token into the typed model. Untyped tokens fall back to
 * the taxonomy's own classification (the same logic that grouped the size UI),
 * with "other"/ambiguous values left untyped rather than guessed.
 */
export function parseSizeToken(token: string): NormalizedSizeFilter {
  const i = token.indexOf(":");
  let type: SizeType | undefined;
  let value = token;
  if (i !== -1 && (SIZE_TYPES as readonly string[]).includes(token.slice(0, i))) {
    type = token.slice(0, i) as SizeType;
    value = token.slice(i + 1);
  } else {
    type = FAMILY_TO_TYPE[sizeFamily(token)];
  }
  return { value, type, system: inferSystem(type, value) };
}

/* ───────────────────────── whole-model conversion ───────────────────────── */

/** SearchFilters (URL-shaped) → the full marketplace-neutral model. */
export function normalizeFilters(f: SearchFilters): NormalizedSearchFilters {
  return {
    departments: f.genders,
    categories: f.categories,
    brands: f.brands,
    sizes:
      f.sizeFilters ??
      f.sizes?.map((s) => parseSizeToken(s)),
    conditions: f.conditions,
    colors: f.colors,
    minPrice: f.minPrice,
    maxPrice: f.maxPrice,
  };
}
