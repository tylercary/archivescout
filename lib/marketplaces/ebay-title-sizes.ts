import type { NormalizedSizeFilter } from "./types";

/**
 * Title-verified size matching — the recall supplement to aspect filtering.
 *
 * Many eBay sellers never fill the structured size aspect; the size lives only
 * in the title, often in composite forms ("Size 45 EU/12 US", "Sz 42(9)",
 * "Size 43( 10", "41.5 Europe"). eBay's own site finds these via fuzzy text
 * search; ArchiveScout's aspect filter cannot. The supplemental search pass
 * keeps such a listing ONLY when its own title provably states the filtered
 * size — the match below returns the verified display value, or null.
 *
 * Deliberately conservative: every pattern anchors on an explicit size marker
 * (size/sz/US/EU/W/waist or a parenthesised conversion). A bare number in a
 * title is never trusted.
 */

const NUM = String.raw`\d{1,2}(?:[.,]5)?`;

function norm(v: string): string {
  return v.replace(",", ".").replace(/\.0$/, "");
}

/** All US-shoe-size candidates provably stated in a title. */
export function titleUsShoeSizes(title: string): string[] {
  const out = new Set<string>();
  for (const re of [
    new RegExp(String.raw`\b(${NUM})\s*us\b`, "gi"), //  "12 US", "10US"
    new RegExp(String.raw`\bus\s*[:.]?\s*(${NUM})\b`, "gi"), //  "US 10"
    // EU-first with US conversion in parens: "42(9)", "Size 43( 10", "43 (10)"
    new RegExp(String.raw`\b(?:3[3-9]|4\d|5[0-4])(?:[.,]5)?\s*\(\s*(${NUM})\s*\)?`, "g"),
  ]) {
    for (const m of title.matchAll(re)) {
      const n = parseFloat(norm(m[1]));
      if (n >= 3 && n <= 18) out.add(norm(m[1]));
    }
  }
  // Plain "size 10" / "sz 10" — US only when in US range (41.5 is EU, not US).
  for (const m of title.matchAll(
    new RegExp(String.raw`\b(?:size|sz)[:.\s]*(${NUM})\b`, "gi"),
  )) {
    const n = parseFloat(norm(m[1]));
    if (n >= 3 && n <= 16) out.add(norm(m[1]));
  }
  return [...out];
}

/** All EU-shoe-size candidates provably stated in a title. */
export function titleEuShoeSizes(title: string): string[] {
  const out = new Set<string>();
  for (const re of [
    new RegExp(String.raw`\b(${NUM})\s*(?:eu|eur|europe)\b`, "gi"), // "43 EU", "41.5 Europe"
    new RegExp(String.raw`\b(?:eu|eur)\s*[:.]?\s*(${NUM})\b`, "gi"), // "EU 43"
    new RegExp(String.raw`\b(?:size|sz)[:.\s]*(${NUM})\b`, "gi"), // "size 43" in EU range
  ]) {
    for (const m of title.matchAll(re)) {
      const n = parseFloat(norm(m[1]));
      if (n >= 33 && n <= 54) out.add(norm(m[1]));
    }
  }
  return [...out];
}

/** Waist candidates: "34x32", "W34", "34W", "waist 34", "size 34" (18–60). */
export function titleWaistSizes(title: string): string[] {
  const out = new Set<string>();
  for (const re of [
    new RegExp(String.raw`\b(\d{2})\s?x\s?\d{2}\b`, "gi"),
    new RegExp(String.raw`\bw\s?(\d{2})\b`, "gi"),
    new RegExp(String.raw`\b(\d{2})\s?w\b`, "gi"),
    new RegExp(String.raw`\bwaist\s*[:.]?\s*(\d{2})\b`, "gi"),
    new RegExp(String.raw`\b(?:size|sz)[:.\s]*(\d{2})\b`, "gi"),
  ]) {
    for (const m of title.matchAll(re)) {
      const n = parseInt(m[1], 10);
      if (n >= 18 && n <= 60) out.add(String(n));
    }
  }
  return [...out];
}

/** Letter-size candidates: only when explicitly marked ("size L", "sz. XL"). */
export function titleLetterSizes(title: string): string[] {
  const out = new Set<string>();
  for (const m of title.matchAll(
    /\b(?:size|sz)[:.\s]*(\d?X{0,3}[SML])\b/gi,
  )) {
    out.add(m[1].toUpperCase());
  }
  return [...out];
}

/**
 * Does this title provably state the filtered size? Returns the verified
 * display value (the listing's OWN wording, e.g. "10"), or null.
 */
export function titleSizeMatch(
  title: string,
  filter: NormalizedSizeFilter,
): string | null {
  const want = filter.value.trim().toLowerCase().replace(/\.0$/, "");
  let candidates: string[];
  switch (filter.type) {
    case "footwear":
      candidates =
        filter.system === "EU" ? titleEuShoeSizes(title) : titleUsShoeSizes(title);
      break;
    case "waist":
      candidates = titleWaistSizes(title);
      break;
    case "clothing":
      candidates = titleLetterSizes(title);
      break;
    default:
      return null;
  }
  const hit = candidates.find((c) => c.toLowerCase() === want);
  return hit ?? null;
}
