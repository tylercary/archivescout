import type { VerifiedListingSize } from "./types";
import { parseSizeString } from "./size-string-parser";
import { categoryFamily, type GarmentFamily } from "@/lib/search/size-invariant";

/**
 * Centralized parser for eBay getItem `localizedAspects` — the structured,
 * per-item attributes that item_summary never carries. Everything returned
 * here is VERIFIED listing data (source: the listing itself), which is what
 * Quick View / Compare display in place of the conservative summary fields.
 */

export interface DetailAspects {
  /** name (lowercased) → value, first occurrence wins. */
  byName: Map<string, string>;
}

export function collectAspects(
  localizedAspects: { name: string; value: string }[] | null | undefined,
): DetailAspects {
  const byName = new Map<string, string>();
  for (const a of localizedAspects ?? []) {
    const key = a.name.trim().toLowerCase();
    if (!byName.has(key) && a.value) byName.set(key, a.value.trim());
  }
  return { byName };
}

export function aspect(
  aspects: DetailAspects,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const hit = aspects.byName.get(name.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Extract the verified size from an item's aspects.
 *
 * Family-specific aspects (US/EU/UK Shoe Size, Waist Size) carry their own
 * meaning. A GENERIC "Size" aspect is only accepted when the item's category
 * is compatible with a garment size family — a handbag's "Size: 13" never
 * becomes footwear metadata, mirroring the search-side invariant. "Size Type"
 * (Regular / Big & Tall) is a modifier, never a size value.
 *
 * The raw aspect text is seller-entered ("EUR39=US8", "W34 L32") — it is
 * parsed into a clean structured value by parseSizeString, which preserves
 * the original in `rawValue` and captures explicitly-present alternatives.
 * Nothing is ever converted between systems.
 */
export function parseVerifiedSize(
  aspects: DetailAspects,
  categoryName?: string,
): VerifiedListingSize | undefined {
  const shoe: [string, "US" | "EU" | "UK"][] = [
    ["us shoe size", "US"],
    ["eu shoe size", "EU"],
    ["uk shoe size", "UK"],
  ];
  for (const [name, system] of shoe) {
    const value = aspects.byName.get(name);
    if (value) {
      const parsed = parseSizeString(value, "footwear", system);
      if (parsed) {
        // The aspect's own system is authoritative for otherwise-unlabeled
        // values ("8" inside "US Shoe Size" is US 8).
        return parsed.system ? parsed : { ...parsed, system };
      }
    }
  }

  const waist = aspects.byName.get("waist size");
  if (waist) {
    return parseSizeString(waist, "waist") ?? undefined;
  }

  const generic = aspects.byName.get("size");
  if (generic) {
    const family: GarmentFamily | null | undefined = categoryFamily(categoryName);
    if (family) {
      return parseSizeString(generic, family) ?? undefined;
    }
  }
  return undefined;
}

/** Department aspect → the app's gender vocabulary. */
export function parseDepartment(
  aspects: DetailAspects,
): "Menswear" | "Womenswear" | undefined {
  const dept = aspect(aspects, "department")?.toLowerCase() ?? "";
  if (/\bmen\b|\bmens\b|\bmen's\b/.test(dept) && !/women/.test(dept)) return "Menswear";
  if (/women/.test(dept)) return "Womenswear";
  return undefined;
}
