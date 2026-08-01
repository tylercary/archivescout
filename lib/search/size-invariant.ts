import type { Listing, NormalizedSizeFilter } from "@/lib/marketplaces/types";

/**
 * Size-family correctness invariant.
 *
 * A size filter is not just a value — "13" as footwear is a different fact
 * from "13" as a handbag's Size aspect. This module is the single source of
 * truth for garment-family classification and the FINAL server-side guard:
 * even after source-side filtering, a listing may only survive an active
 * typed size filter if its own category confirms the family and its own
 * verified size (when present) matches. Generic marketplace "Size" aspects
 * are never trusted across families.
 */

export type GarmentFamily = "footwear" | "waist" | "clothing";

/* ─────────────────────── category classification ─────────────────────── */

const FOOTWEAR = /\b(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|flat|flats|mule|mules|slide|slides|cleat|cleats|slipper|slippers|footwear|espadrille|oxford|derby|pump|pumps|runner|runners|slip[- ]?ons?)\b/i;
const WAIST = /\b(jean|jeans|pant|pants|trouser|trousers|short|shorts|bottom|bottoms|chino|chinos|denim|overall|overalls|jumpsuit|jumpsuits|legging|leggings|sweatpant|sweatpants|jogger|joggers)\b/i;
const CLOTHING = /\b(shirt|shirts|t-shirt|tee|tees|top|tops|jacket|jackets|coat|coats|sweater|sweaters|sweatshirt|sweatshirts|hoodie|hoodies|knitwear|blazer|blazers|vest|vests|outerwear|dress|dresses|cardigan|polo|polos|fleece|parka|parkas|windbreaker|clothing|skirt|skirts|blouse|blouses|jersey|jerseys)\b/i;
/** Categories that can NEVER satisfy a garment size filter. */
const NON_GARMENT = /\b(bag|bags|handbag|handbags|wallet|wallets|purse|purses|backpack|backpacks|luggage|jewelry|jewellery|necklace|bracelet|ring|rings|earring|earrings|watch|watches|scarf|scarves|belt|belts|hat|hats|cap|caps|beanie|sunglasses|eyewear|glasses|accessor\w*|keychain|book|books|magazine|perfume|fragrance|cosmetic|lace|laces|insole|insoles|care|cleaner|poster|sticker|figure|toy|toys)\b/i;

/**
 * Classify a listing category name into a garment family.
 * Returns null for confirmed non-garment categories (bags, jewelry, …) and
 * undefined when the name is unknown/ambiguous.
 */
export function categoryFamily(
  categoryName?: string,
): GarmentFamily | null | undefined {
  if (!categoryName) return undefined;
  // Non-garment wins first: "Shoe Laces" and "Shoe Care" mention shoes but
  // aren't footwear; "Bag" beats any stray garment word.
  if (NON_GARMENT.test(categoryName)) return null;
  if (FOOTWEAR.test(categoryName)) return "footwear";
  if (WAIST.test(categoryName)) return "waist";
  if (CLOTHING.test(categoryName)) return "clothing";
  return undefined;
}

/** Family implied by the QUERY text itself ("chanel runners" → footwear). */
export function queryGarmentFamily(query: string): GarmentFamily | undefined {
  if (NON_GARMENT.test(query)) return undefined; // "chanel handbags" — not sized
  if (FOOTWEAR.test(query)) return "footwear";
  if (WAIST.test(query)) return "waist";
  if (CLOTHING.test(query)) return "clothing";
  return undefined;
}

/* ─────────────────────────── the invariant ─────────────────────────── */

/**
 * Does the listing's category satisfy the filter's family?
 *
 * `requireConfirmed` — for sources whose size filtering rests on GENERIC
 * aspects (eBay's "Size") the category must POSITIVELY confirm the family;
 * unknown is a failure. Sources that filter through family-scoped facets at
 * origin (Grailed's category_size footwear.13) only fail on a positive
 * mismatch — their guarantee comes from the source, and rejecting unknown
 * names would delete correct results ("Leather" is a real Grailed footwear
 * category). Confirmed non-garment categories (bags, jewelry, books) fail
 * for every source.
 */
export function matchesSizeFamily(
  listing: Listing,
  type: GarmentFamily,
  requireConfirmed: boolean,
): boolean {
  const family = categoryFamily(listing.category);
  if (family === null) return false; // confirmed non-garment
  if (requireConfirmed) return family === type;
  return family === undefined || family === type;
}

/** Normalize a size label for comparison ("34 in" → "34", case-insensitive). */
function canonSizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s*in$/i, "");
}

/**
 * Does the listing's OWN size data agree with the filter?
 * A missing size passes (the family gate + source-side filtering carry it);
 * a PRESENT size that contradicts the filter fails. Waist "34x32" matches a
 * waist filter of 34.
 */
export function matchesVerifiedSize(
  listing: Listing,
  filter: NormalizedSizeFilter,
): boolean {
  if (!listing.size) return true;
  const have = canonSizeValue(listing.size);
  const want = canonSizeValue(filter.value);
  if (have === want) return true;
  if (filter.type === "waist") {
    const wx = have.match(/^(\d{2})\s?x\s?\d{2}$/);
    if (wx && wx[1] === want) return true;
  }
  return false;
}

/**
 * Apply the invariant to a result set under the active size filters.
 * A listing survives if it satisfies ANY selected size (OR semantics), where
 * satisfying a TYPED size requires family confirmation + verified-size
 * agreement. Untyped sizes impose no family constraint (legacy behavior).
 *
 * Dev builds log every removal that looks like the original bug — a listing
 * carrying the filter's exact value in a mismatched family.
 */
export function enforceSizeInvariant<T extends Listing>(
  listings: T[],
  sizeFilters: NormalizedSizeFilter[],
  /** Which listings need POSITIVE family confirmation (see matchesSizeFamily).
   *  Default: all. The engine passes marketplace-aware strictness. */
  requireConfirmedFamily: (listing: Listing) => boolean = () => true,
): T[] {
  const typed = sizeFilters.filter((s) => s.type);
  if (typed.length === 0) return listings;

  return listings.filter((listing) => {
    const ok = sizeFilters.some((sel) => {
      if (!sel.type) return true;
      return (
        matchesSizeFamily(listing, sel.type, requireConfirmedFamily(listing)) &&
        matchesVerifiedSize(listing, sel)
      );
    });
    if (!ok && process.env.NODE_ENV !== "production") {
      const guilty = typed.find(
        (sel) =>
          listing.size?.toLowerCase() === sel.value.toLowerCase() &&
          categoryFamily(listing.category) !== sel.type,
      );
      if (guilty) {
        // eslint-disable-next-line no-console
        console.error("Invalid size metadata assignment", {
          id: listing.id,
          title: listing.title.slice(0, 60),
          category: listing.category,
          listingSize: listing.size,
          filter: guilty,
        });
      }
    }
    return ok;
  });
}
