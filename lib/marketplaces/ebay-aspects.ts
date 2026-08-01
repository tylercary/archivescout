import type { NormalizedSizeFilter } from "./types";
import type { EbayItemSummary, EbayRefinement } from "./schemas";

/**
 * eBay aspect discovery + mapping — the machinery behind SOURCE-SIDE size and
 * color filtering on the Browse API.
 *
 * eBay has no universal "size" field. Each leaf category exposes its own
 * aspects ("US Shoe Size" / "EU Shoe Size" for shoes, "Waist Size" ("34 in")
 * and "Size" for pants, plain "Size" for jackets…), discovered per query via
 * `fieldgroups=ASPECT_REFINEMENTS` and applied via
 * `aspect_filter=categoryId:<id>,<Aspect>:{v1|v2}`.
 *
 * Everything here is pure: the provider fetches, this module decides.
 */

/* ─────────────────────────── catalog shape ─────────────────────────── */

export interface AspectCatalog {
  /** Leaf/dominant category the aspects belong to — aspect_filter requires it. */
  categoryId: string;
  /** eBay's own name for the category ("Athletic Shoes", "Women's Bags &
   *  Handbags") — the evidence plan validation uses to confirm the garment
   *  family before trusting a generic "Size" aspect. */
  categoryName?: string;
  /** localizedAspectName → its localizedAspectValues, verbatim from eBay. */
  aspects: Map<string, string[]>;
  /** The Brand aspect's value vocabulary (used to improve brand extraction). */
  brands: string[];
}

/** A concrete, sendable aspect selection for one filter dimension. */
export interface AspectSelection {
  /** Exact eBay aspect name, e.g. "US Shoe Size" or "Waist Size". */
  aspectName: string;
  /** Exact eBay aspect values to send, e.g. ["34 in"] — never invented labels. */
  values: string[];
  /** The user's own labels that mapped (e.g. ["34"]). */
  mappedUserValues: string[];
  /** User labels that could NOT be mapped (covered by other marketplaces only). */
  unmappedUserValues: string[];
}

/** Build a catalog from a refinement block returned by eBay. */
export function catalogFromRefinement(
  categoryId: string,
  refinement: EbayRefinement,
  categoryName?: string,
): AspectCatalog {
  const aspects = new Map<string, string[]>();
  for (const a of refinement.aspectDistributions ?? []) {
    aspects.set(
      a.localizedAspectName,
      a.aspectValueDistributions.map((v) => v.localizedAspectValue),
    );
  }
  return { categoryId, categoryName, aspects, brands: aspects.get("Brand") ?? [] };
}

/** Family implied by a catalog's ASPECTS alone: a category exposing shoe-size
 *  or waist aspects declares its own family even when its name is unknown. */
export function aspectImpliedFamily(
  catalog: AspectCatalog,
): "footwear" | "waist" | undefined {
  if (
    catalog.aspects.has("US Shoe Size") ||
    catalog.aspects.has("EU Shoe Size") ||
    catalog.aspects.has("UK Shoe Size")
  )
    return "footwear";
  if (catalog.aspects.has("Waist Size") || catalog.aspects.has("Inseam"))
    return "waist";
  return undefined;
}

/** Size-bearing aspect names, in preference order for tie-breaking. */
const SIZE_ASPECT_PRIORITY = [
  "US Shoe Size",
  "Waist Size",
  "Size",
  "EU Shoe Size",
  "UK Shoe Size",
] as const;

/** Does this refinement expose ANY size aspect worth planning against? */
export function hasSizeAspect(refinement: EbayRefinement | null | undefined): boolean {
  return (refinement?.aspectDistributions ?? []).some((a) =>
    (SIZE_ASPECT_PRIORITY as readonly string[]).includes(a.localizedAspectName),
  );
}

/**
 * Tally leafCategoryIds across item summaries → the top N leaf categories,
 * most-populated first. Sized items for one query live in several leaves
 * (women's + men's athletic shoes, casual shoes…), and eBay allows only one
 * category per aspect-filtered request, so callers fan out over these.
 */
export function topLeafCategories(
  items: EbayItemSummary[],
  max: number,
): { categoryId: string; categoryName?: string }[] {
  const tally = new Map<string, number>();
  const names = new Map<string, string>();
  for (const item of items) {
    const leaves = item.leafCategoryIds ?? [];
    for (const leaf of leaves) {
      tally.set(leaf, (tally.get(leaf) ?? 0) + 1);
    }
    for (const c of item.categories ?? []) {
      if (c.categoryId && c.categoryName && leaves.includes(c.categoryId)) {
        names.set(c.categoryId, c.categoryName);
      }
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([categoryId]) => ({ categoryId, categoryName: names.get(categoryId) }));
}

/** Dominant single leaf — kept for callers that only need the top one. */
export function dominantLeafCategory(items: EbayItemSummary[]): string | undefined {
  return topLeafCategories(items, 1)[0]?.categoryId;
}

/* ─────────────────────────── size mapping ─────────────────────────── */

/** "xxl" → "2XL" etc — eBay's letter-size canon uses the 2XL/3XL form. */
function canonLetter(value: string): string {
  const v = value.trim().toUpperCase();
  const m = v.match(/^(X+)(S|L)$/);
  if (m && m[1].length >= 2) return `${m[1].length}X${m[2]}`;
  return v;
}

const LETTER_SIZES = /^(?:\d?X+[SL]|X{0,4}[SML]|\d+X[SL])$/i;

/**
 * Map ONE user size label to an exact value of the given aspect, or null.
 *
 * Order: exact membership in the aspect's (possibly truncated) value list,
 * then bounded synthesis — "Waist Size" lists are cut off at ~12 entries, so
 * a numeric waist becomes "<n> in" even when unlisted; filtering by an absent
 * value merely returns fewer items, never wrong ones.
 */
function mapSizeToAspectValue(
  userValue: string,
  aspectName: string,
  values: string[],
): string | null {
  const raw = userValue.trim();
  const lower = raw.toLowerCase();
  const byLower = new Map(values.map((v) => [v.toLowerCase(), v]));

  // Waist-x-inseam ("34x32") → the waist number for waist-like aspects.
  const wx = raw.match(/^(\d{2})\s?x\s?\d{2}$/i);
  const numericText = wx ? wx[1] : raw;
  const n = /^\d{1,2}(?:\.5)?$/.test(numericText) ? parseFloat(numericText) : null;

  // 1. Exact (case-insensitive) membership — including letter-size canon.
  const direct = byLower.get(lower) ?? byLower.get(canonLetter(raw).toLowerCase());
  if (direct) return direct;

  // 2. Bounded synthesis per aspect family.
  if (n !== null) {
    if (aspectName === "Waist Size" && n >= 18 && n <= 60) return `${numericText} in`;
    if (aspectName === "US Shoe Size" && n >= 3 && n <= 18) return numericText;
    if (aspectName === "EU Shoe Size" && n >= 33 && n <= 54) return numericText;
    if (aspectName === "UK Shoe Size" && n >= 1 && n <= 15) return numericText;
    if (aspectName === "Size" && n >= 0 && n <= 60) return numericText;
  }
  if (aspectName === "Size" && LETTER_SIZES.test(raw)) return canonLetter(raw);

  return null;
}

/**
 * Aspect names a typed size is allowed to map to. Untyped → all.
 *
 * Generic "Size" stays allowed for US/unsystemed footwear: plenty of shoe
 * categories expose ONLY a "Size" aspect (US-denominated on EBAY_US), and
 * banning it silently dropped most real shoe results. Plan categories come
 * from the query's own leaf tally, so a shoe query's "Size" is a shoe size.
 * EU/UK are explicit systems with dedicated aspects — those stay exclusive.
 */
function allowedAspects(detail: NormalizedSizeFilter | undefined): readonly string[] {
  if (!detail?.type) return SIZE_ASPECT_PRIORITY;
  switch (detail.type) {
    case "footwear":
      if (detail.system === "EU") return ["EU Shoe Size"];
      if (detail.system === "UK") return ["UK Shoe Size"];
      if (detail.system === "US") return ["US Shoe Size", "Size"];
      return ["US Shoe Size", "EU Shoe Size", "UK Shoe Size", "Size"];
    case "waist":
      return ["Waist Size", "Size"];
    case "clothing":
      return ["Size"];
  }
}

/**
 * Choose the single best size aspect for the user's selected sizes.
 *
 * One aspect only — spreading values across two aspects would AND them at
 * eBay, silently over-restricting an OR-semantics filter. The aspect mapping
 * the MOST selected values wins; ties break on SIZE_ASPECT_PRIORITY (US shoe
 * sizes beat EU when both match, matching an EBAY_US marketplace).
 *
 * `details` (the normalized typed model) restricts which aspects each value
 * may map to — a "footwear" 13 can never land on a Waist Size aspect, and an
 * EU 39 goes ONLY to "EU Shoe Size".
 */
export function selectSizeAspect(
  selectedSizes: string[],
  catalog: AspectCatalog,
  details?: NormalizedSizeFilter[],
): AspectSelection | null {
  let best: AspectSelection | null = null;
  let bestRank = Number.MAX_SAFE_INTEGER;
  const detailOf = new Map(
    (details ?? []).map((d) => [d.value.toLowerCase(), d]),
  );

  for (const [rank, aspectName] of SIZE_ASPECT_PRIORITY.entries()) {
    const values = catalog.aspects.get(aspectName);
    if (!values) continue;

    const sendValues: string[] = [];
    const mapped: string[] = [];
    const unmapped: string[] = [];
    for (const size of selectedSizes) {
      if (!allowedAspects(detailOf.get(size.toLowerCase())).includes(aspectName)) {
        unmapped.push(size);
        continue;
      }
      const value = mapSizeToAspectValue(size, aspectName, values);
      if (value) {
        if (!sendValues.includes(value)) sendValues.push(value);
        mapped.push(size);
      } else {
        unmapped.push(size);
      }
    }
    if (mapped.length === 0) continue;

    if (
      !best ||
      mapped.length > best.mappedUserValues.length ||
      (mapped.length === best.mappedUserValues.length && rank < bestRank)
    ) {
      best = {
        aspectName,
        values: sendValues,
        mappedUserValues: mapped,
        unmappedUserValues: unmapped,
      };
      bestRank = rank;
    }
  }
  return best;
}

/* ─────────────────────────── color mapping ─────────────────────────── */

/**
 * Map selected colors onto the category's "Color" aspect. Only values the
 * category actually lists are sent — no synthesis, colors are free text.
 * Returns null when the category exposes no Color aspect or nothing maps.
 */
export function selectColorAspect(
  selectedColors: string[],
  catalog: AspectCatalog,
): AspectSelection | null {
  const values = catalog.aspects.get("Color");
  if (!values?.length) return null;
  const byLower = new Map(values.map((v) => [v.toLowerCase(), v]));

  const sendValues: string[] = [];
  const mapped: string[] = [];
  const unmapped: string[] = [];
  for (const color of selectedColors) {
    const value = byLower.get(color.trim().toLowerCase());
    if (value) {
      if (!sendValues.includes(value)) sendValues.push(value);
      mapped.push(color);
    } else {
      unmapped.push(color);
    }
  }
  if (mapped.length === 0) return null;
  return { aspectName: "Color", values: sendValues, mappedUserValues: mapped, unmappedUserValues: unmapped };
}

/* ─────────────────────────── brand vocabulary ─────────────────────────── */

/**
 * Match a title against eBay's own Brand aspect vocabulary (longest first, so
 * "Polo Ralph Lauren" beats "Ralph Lauren"). Aspect-provided names beat any
 * hardcoded list because they are the values eBay itself indexed.
 */
export function brandFromVocabulary(
  title: string,
  vocabulary: string[],
): string | undefined {
  if (!vocabulary.length) return undefined;
  const lower = title.toLowerCase();
  return [...vocabulary]
    .sort((a, b) => b.length - a.length)
    .find((brand) => brand.length >= 3 && lower.includes(brand.toLowerCase()));
}
