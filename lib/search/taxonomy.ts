import type { FacetBucket } from "@/lib/marketplaces/types";

/**
 * Fashion taxonomy for the filter sidebar.
 *
 * Marketplaces label categories inconsistently ("Sneakers", "Lowtop Sneakers",
 * "Denim", "Jeans"...). This groups whatever facet values a search actually
 * returned into a stable, luxury-retail hierarchy. Nothing is invented: a group
 * only renders when the current results contain at least one of its members.
 */

export const CATEGORY_GROUPS = [
  "Footwear",
  "Tops",
  "Bottoms",
  "Outerwear",
  "Tailoring",
  "Accessories",
] as const;

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

/**
 * Lowercased category values that belong to each group. Covers both the
 * marketplace-native vocabularies (Grailed's `category_path` leaves, eBay's
 * category names) and our mock catalogue.
 */
const GROUP_MEMBERS: Record<CategoryGroup, string[]> = {
  Footwear: [
    "footwear", "sneakers", "lowtop sneakers", "hitop sneakers", "boots",
    "loafers", "sandals", "formal shoes", "slip ons", "leather", "shoes",
  ],
  Tops: [
    "tops", "t-shirts", "t shirts", "tees", "short sleeve shirts",
    "long sleeve shirts", "hoodies", "sweatshirts", "sweatshirts hoodies",
    "sweaters", "sweaters knitwear", "knitwear", "shirts", "button ups",
    "polos", "jerseys", "sleeveless",
  ],
  Bottoms: [
    "bottoms", "denim", "jeans", "casual pants", "pants", "trousers", "shorts",
    "sweatpants", "sweatpants joggers", "joggers", "cropped pants", "leggings",
    "swimwear", "jumpsuits",
  ],
  Outerwear: [
    "outerwear", "jackets", "coats", "heavy coats", "light jackets",
    "leather jackets", "denim jackets", "bombers", "parkas", "raincoats",
    "vests", "cloaks capes",
  ],
  Tailoring: [
    "tailoring", "blazers", "suits", "tuxedos", "formal shirting",
    "formal trousers",
  ],
  Accessories: [
    "accessories", "bags luggage", "bags", "wallets", "belts", "hats",
    "sunglasses", "glasses", "jewelry watches", "watches", "scarves",
    "gloves scarves", "socks underwear", "ties pocketsquares", "periodicals",
    "supreme", "misc",
  ],
};

/** Reverse lookup, built once. */
const MEMBER_TO_GROUP = new Map<string, CategoryGroup>();
for (const group of CATEGORY_GROUPS) {
  for (const member of GROUP_MEMBERS[group]) MEMBER_TO_GROUP.set(member, group);
}

/**
 * Normalize a source-supplied parent group onto our six.
 *
 * Grailed's womenswear taxonomy is gendered at the top level — "Womens
 * Outerwear", "Womens Bags Luggage" — while menswear is plain ("footwear",
 * "tops"). Strip the gender prefix, then resolve what's left.
 */
export function normalizeGroup(group?: string): CategoryGroup | undefined {
  if (!group) return undefined;
  const stripped = group.replace(/^(mens|womens|men's|women's)\s+/i, "").trim();
  const direct = CATEGORY_GROUPS.find(
    (g) => g.toLowerCase() === stripped.toLowerCase(),
  );
  return direct ?? categoryGroupOf(stripped);
}

/** Which group a raw category value belongs to, if any. */
export function categoryGroupOf(value: string): CategoryGroup | undefined {
  const v = value.trim().toLowerCase();
  const direct = MEMBER_TO_GROUP.get(v);
  if (direct) return direct;
  // Fall back to a word-level match so "Vintage Denim Jackets" still lands.
  for (const group of CATEGORY_GROUPS) {
    if (GROUP_MEMBERS[group].some((m) => v.includes(m))) return group;
  }
  return undefined;
}

export interface GroupedCategories {
  group: CategoryGroup | "Other";
  /** Facet buckets belonging to this group, most common first. */
  items: FacetBucket[];
  total: number;
}

/**
 * Group the category facets returned by a search. Groups with no matching
 * results are omitted entirely, so the sidebar only ever offers real choices.
 */
export function groupCategories(buckets: FacetBucket[]): GroupedCategories[] {
  const byGroup = new Map<CategoryGroup | "Other", FacetBucket[]>();
  for (const bucket of buckets) {
    // Trust the source's own hierarchy when it sent one.
    const group =
      normalizeGroup(bucket.group) ?? categoryGroupOf(bucket.value) ?? "Other";
    const list = byGroup.get(group);
    if (list) list.push(bucket);
    else byGroup.set(group, [bucket]);
  }

  const order: (CategoryGroup | "Other")[] = [...CATEGORY_GROUPS, "Other"];
  return order
    .filter((g) => byGroup.has(g))
    .map((group) => {
      const items = (byGroup.get(group) ?? []).sort(
        (a, b) => b.count - a.count || a.value.localeCompare(b.value),
      );
      return {
        group,
        items,
        total: items.reduce((sum, i) => sum + i.count, 0),
      };
    });
}

/* ─────────────────────────── sizes ─────────────────────────── */

export type SizeFamily = "footwear" | "bottoms" | "tops" | "other";

/** Human labels for the size scales shown as sub-headings. */
export const SIZE_FAMILY_LABELS: Record<SizeFamily, string> = {
  footwear: "Footwear",
  bottoms: "Waist",
  tops: "Clothing",
  other: "Other",
};

/**
 * Size family for a facet bucket. Prefers the parent group the source supplied
 * ("accessories.one_size" → Accessories) over guessing from the label, which
 * can't tell a waist 34 from a shoe 34.
 */
export function sizeFamilyOfBucket(bucket: FacetBucket): SizeFamily {
  // Normalize first — womenswear groups arrive gendered ("Womens Footwear").
  const group = normalizeGroup(bucket.group);
  if (group === "Footwear") return "footwear";
  if (group === "Bottoms") return "bottoms";
  if (group === "Tops" || group === "Outerwear" || group === "Tailoring") {
    return "tops";
  }
  if (group === "Accessories") return "other";
  return sizeFamily(bucket.value);
}

/** Bucket sizes by scale, preserving each scale's natural order. */
export function groupSizes(
  buckets: FacetBucket[],
): { family: SizeFamily; items: FacetBucket[] }[] {
  const byFamily = new Map<SizeFamily, FacetBucket[]>();
  for (const bucket of buckets) {
    const family = sizeFamilyOfBucket(bucket);
    const list = byFamily.get(family);
    if (list) list.push(bucket);
    else byFamily.set(family, [bucket]);
  }
  const order: SizeFamily[] = ["footwear", "tops", "bottoms", "other"];
  return order
    .filter((f) => byFamily.has(f))
    .map((family) => ({
      family,
      items: (byFamily.get(family) ?? []).sort((a, b) =>
        compareSizes(a.value, b.value),
      ),
    }));
}

/** Category groups whose sizes share a scale. */
const GROUP_TO_SIZE_FAMILY: Partial<Record<CategoryGroup, SizeFamily>> = {
  Footwear: "footwear",
  Bottoms: "bottoms",
  Tops: "tops",
  Outerwear: "tops",
  Tailoring: "tops",
};

const LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

/** Classify a size string so the sidebar can show one coherent scale. */
export function sizeFamily(size: string): SizeFamily {
  const s = size.trim().toUpperCase().replace(/"/g, "");
  if (LETTER_ORDER.includes(s)) return "tops";
  // Waist×inseam ("34x32") or a bare waist number in denim range.
  if (/^\d{2}\s?[X]\s?\d{2}$/.test(s)) return "bottoms";
  const bare = s.replace(/^(US|EU|UK)\s*/, "");
  const n = Number.parseFloat(bare);
  if (Number.isFinite(n)) {
    // Shoe scales run ~4–16 (halves allowed); waists run ~24–46 (whole).
    if (/\.5$/.test(bare) || (n >= 4 && n <= 16)) return "footwear";
    if (n >= 24 && n <= 46) return "bottoms";
  }
  return "other";
}

/** Natural ordering: letters by scale, numbers ascending, rest alphabetical. */
export function compareSizes(a: string, b: string): number {
  const fa = sizeFamily(a);
  const fb = sizeFamily(b);
  if (fa === "tops" && fb === "tops") {
    const na = a.trim().toUpperCase().replace(/"/g, "");
    const nb = b.trim().toUpperCase().replace(/"/g, "");
    return LETTER_ORDER.indexOf(na) - LETTER_ORDER.indexOf(nb);
  }
  const num = (s: string) =>
    Number.parseFloat(s.trim().toUpperCase().replace(/"/g, "").replace(/^(US|EU|UK)\s*/, ""));
  const na = num(a);
  const nb = num(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/**
 * The size scale implied by the selected categories. Returns `undefined` when
 * nothing (or a mix) is selected, meaning "show every size present".
 */
export function sizeFamilyForCategories(
  selectedCategories: string[],
): SizeFamily | undefined {
  const families = new Set<SizeFamily>();
  for (const c of selectedCategories) {
    const group = categoryGroupOf(c);
    const family = group ? GROUP_TO_SIZE_FAMILY[group] : undefined;
    if (family) families.add(family);
  }
  return families.size === 1 ? [...families][0] : undefined;
}

/**
 * Facets only describe the listings loaded so far, so an early page yields a
 * gappy scale (5, 6, 6.5, 7, 8, 8.5, 10, 12 — no 9, 9.5, 11). That reads as
 * broken. Fill the standard steps *between the observed min and max* so the
 * scale looks whole.
 *
 * These are real, useful choices rather than decoration: size is pushed into
 * Grailed's own query, so selecting a filled-in size re-searches the source and
 * can return listings that simply weren't in the loaded page. Nothing is
 * invented beyond the observed range, and filled entries carry no count.
 */
export function fillSizeScale(
  observed: FacetBucket[],
  family: SizeFamily | undefined,
): FacetBucket[] {
  if (!family || family === "other" || observed.length < 2) return observed;

  const present = new Set(observed.map((b) => b.value));
  const filled: FacetBucket[] = [...observed];

  if (family === "tops") {
    const indexes = observed
      .map((b) => LETTER_ORDER.indexOf(b.value.trim().toUpperCase()))
      .filter((i) => i >= 0);
    if (indexes.length < 2) return observed;
    for (let i = Math.min(...indexes); i <= Math.max(...indexes); i += 1) {
      if (!present.has(LETTER_ORDER[i])) {
        filled.push({ value: LETTER_ORDER[i], count: 0 });
      }
    }
    return filled;
  }

  // Numeric scales. Only fill when every observed value is a plain number —
  // formats like "34x32" or "US 9" can't be enumerated safely.
  if (!observed.every((b) => /^\d{1,2}(\.5)?$/.test(b.value.trim()))) {
    return observed;
  }
  const nums = observed.map((b) => Number.parseFloat(b.value));
  const step = family === "footwear" ? 0.5 : 1;
  for (let n = Math.min(...nums); n <= Math.max(...nums); n += step) {
    const label = Number.isInteger(n) ? String(n) : n.toFixed(1);
    if (!present.has(label)) filled.push({ value: label, count: 0 });
  }
  return filled;
}

/**
 * The scale a result set is *actually* about, inferred from its own size
 * facets. A search like "chanel runner" returns mostly footwear, so the sidebar
 * should offer shoe sizes rather than mixing in a stray waist 30 or an XS from
 * an unrelated listing.
 *
 * Only returns a family when it clearly dominates (≥60% of sized listings and
 * at least two distinct sizes), so genuinely mixed result sets still show
 * everything.
 */
export function dominantSizeFamily(
  buckets: FacetBucket[],
): SizeFamily | undefined {
  const byFamily = new Map<SizeFamily, { count: number; values: number }>();
  let total = 0;

  for (const b of buckets) {
    const family = sizeFamily(b.value);
    if (family === "other") continue;
    const entry = byFamily.get(family) ?? { count: 0, values: 0 };
    entry.count += b.count;
    entry.values += 1;
    byFamily.set(family, entry);
    total += b.count;
  }
  if (total === 0) return undefined;

  const ranked = [...byFamily.entries()].sort((a, b) => b[1].count - a[1].count);
  const [family, stats] = ranked[0];
  return stats.count / total >= 0.6 && stats.values >= 2 ? family : undefined;
}
