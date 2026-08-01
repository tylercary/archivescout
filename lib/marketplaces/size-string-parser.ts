import type { VerifiedListingSize } from "./types";

/**
 * Conservative parser for seller-entered size strings.
 *
 * eBay detail aspects arrive as free text: "EUR39=US8", "EU 39 / US 8",
 * "US13 (EU46)", "34 in", "W34 L32", "Size Large (L)", "Mens 10", "10M".
 * This module turns them into a clean structured value while PRESERVING the
 * raw string, and formats them for display.
 *
 * Rules:
 * - Only explicitly labeled systems are recognized — never a conversion chart.
 *   "EU 39" alone stays EU 39; no invented US equivalent, no gender guessing.
 * - The raw value is kept whenever cleaning changed anything.
 * - Dependency-free on purpose: unit tests run this file directly under Node.
 */

type System = "US" | "EU" | "UK";
type Family = "footwear" | "waist" | "clothing";

const NUM = String.raw`\d{1,2}(?:[.,]5)?`;

const normNum = (v: string) => v.replace(",", ".").replace(/\.0$/, "");

interface LabeledToken {
  value: string;
  system: System;
}

/** All system-labeled size tokens explicitly present in the string. */
function labeledTokens(raw: string): LabeledToken[] {
  const out: LabeledToken[] = [];
  const seen = new Set<string>();
  const push = (system: System, num: string) => {
    const value = normNum(num);
    const key = `${system}:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ value, system });
    }
  };
  const SYS = { us: "US", uk: "UK", eu: "EU", eur: "EU" } as const;
  // Prefix form: "US 8", "US8", "EUR39", "EU 39", "UK 9"
  for (const m of raw.matchAll(
    new RegExp(String.raw`\b(us|eur|eu|uk)\s*[:.]?\s*(${NUM})\b`, "gi"),
  )) {
    push(SYS[m[1].toLowerCase() as keyof typeof SYS], m[2]);
  }
  // Suffix form: "39 EU", "8US"
  for (const m of raw.matchAll(
    new RegExp(String.raw`\b(${NUM})\s*(us|eur|eu|uk)\b`, "gi"),
  )) {
    push(SYS[m[2].toLowerCase() as keyof typeof SYS], m[1]);
  }
  return out;
}

/** "W34 L32" / "W34" → { waist, inseam? }. */
function waistInseam(raw: string): { waist: string; inseam?: string } | null {
  const wl = raw.match(/\bw\s*(\d{2})\b(?:\s*[x×/,]?\s*l\s*(\d{2})\b)?/i);
  if (wl) return { waist: wl[1], inseam: wl[2] };
  const wx = raw.match(/\b(\d{2})\s*[x×]\s*(\d{2})\b/);
  if (wx) return { waist: wx[1], inseam: wx[2] };
  const inches = raw.match(new RegExp(String.raw`^\s*(\d{2})\s*(?:in|")\s*$`, "i"));
  if (inches) return { waist: inches[1] };
  return null;
}

const WORD_LETTER: Record<string, string> = {
  "x-small": "XS", xsmall: "XS", small: "S", medium: "M", large: "L",
  "x-large": "XL", xlarge: "XL", "xx-large": "2XL", xxlarge: "2XL",
};

/** Letter size ("Large / L", "Size Large (L)", "XL") → canonical letter. */
function letterSize(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (/\bone[\s-]?size\b|\bos\b|\bo\/s\b/.test(lower)) return "One Size";
  for (const [word, canon] of Object.entries(WORD_LETTER)) {
    if (lower.includes(word)) return canon;
  }
  const m = raw.match(/(?:^|[\s(/])(\d?X{0,3}[SML])(?:$|[\s)/])/i);
  if (m) return m[1].toUpperCase().replace(/^(X{2,})([SL])$/, (_, xs, sl) => `${xs.length}X${sl}`);
  return null;
}

/**
 * Parse a raw seller-entered size string into a structured VerifiedListingSize.
 *
 * `aspectSystem` — the system the ASPECT itself declares (a "US Shoe Size"
 * aspect is US even when its text leads with EU). Preferred for the primary.
 * Returns null when nothing recognizable is present AND raw is empty-ish.
 */
export function parseSizeString(
  raw: string,
  family: Family,
  aspectSystem?: System,
): VerifiedListingSize | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const base = { type: family, source: "ebay_detail" as const };
  const withRaw = (value: string, extra?: Partial<VerifiedListingSize>): VerifiedListingSize => ({
    value,
    ...base,
    ...extra,
    ...(trimmed !== value ? { rawValue: trimmed } : {}),
  });

  if (family === "waist") {
    const wl = waistInseam(trimmed);
    if (wl) return withRaw(wl.waist);
    const plain = trimmed.match(/^\s*(\d{2})\s*$/);
    if (plain) return withRaw(plain[1]);
    return withRaw(trimmed.replace(/\s*in$/i, ""));
  }

  if (family === "clothing") {
    const letter = letterSize(trimmed);
    if (letter) return withRaw(letter);
    return withRaw(trimmed);
  }

  // footwear
  const tokens = labeledTokens(trimmed);
  if (tokens.length > 0) {
    // Primary: the aspect's own system → US (EBAY_US) → first labeled.
    const primary =
      tokens.find((t) => t.system === aspectSystem) ??
      tokens.find((t) => t.system === "US") ??
      tokens[0];
    const alternatives = tokens
      .filter((t) => t !== primary)
      .map((t) => ({ value: t.value, system: t.system }));
    return withRaw(primary.value, {
      system: primary.system,
      ...(alternatives.length ? { alternatives } : {}),
    });
  }
  // Multi-size list ("5.5 / 6 / 6.5 / 8.5"): sellers stocking several sizes
  // put them all in one aspect value. Unambiguous when every token is a plain
  // numeric in ONE system's range — primary = first, rest = alternatives.
  const listParts = trimmed.split(/[\/,|]/).map((s) => s.trim()).filter(Boolean);
  if (listParts.length >= 3) {
    const nums = listParts.map((s) =>
      new RegExp(String.raw`^(${NUM})$`).test(s) ? parseFloat(normNum(s)) : null,
    );
    if (nums.every((n) => n !== null)) {
      const values = nums as number[];
      const allUS = values.every((n) => n >= 3 && n <= 18);
      const allEU = values.every((n) => n >= 33 && n <= 54);
      if (allUS || allEU) {
        const system: System = allUS ? (aspectSystem ?? "US") : "EU";
        return withRaw(normNum(listParts[0]), {
          system,
          alternatives: listParts.slice(1).map((v) => ({ value: normNum(v), system })),
        });
      }
    }
  }

  // Unlabeled numeric: non-overlapping ranges only (3–18 US on EBAY_US,
  // 33–54 EU) — anything else passes through untyped, never converted.
  const solo = trimmed.match(new RegExp(String.raw`^\s*(?:mens?|womens?|size|sz)?\s*[:.]?\s*(${NUM})\s*[mw]?\s*$`, "i"));
  if (solo) {
    const n = parseFloat(normNum(solo[1]));
    if (n >= 33 && n <= 54) return withRaw(normNum(solo[1]), { system: "EU" });
    if (n >= 3 && n <= 18)
      return withRaw(normNum(solo[1]), { system: aspectSystem ?? "US" });
  }
  return withRaw(trimmed.replace(/\s*in$/i, ""));
}

/**
 * Display formatting for the size VALUE slot (labels like "Size"/"Waist" come
 * from the surrounding UI — never duplicated here).
 *
 *   footwear, preferred system present → "EU 39"
 *   footwear, no preference           → "US 8 · EU 39" (only explicit systems)
 *   waist with inseam in the raw      → "W34 × L32"
 *   waist                             → "34"
 *   clothing                          → "L" / "One Size"
 */
export function formatVerifiedSize(
  size: VerifiedListingSize,
  preferredSystem?: System,
): string {
  if (size.type === "waist") {
    const wl = size.rawValue ? waistInseam(size.rawValue) : null;
    if (wl?.inseam) return `W${wl.waist} × L${wl.inseam}`;
    return size.value;
  }
  if (size.type === "clothing") return size.value;

  // footwear
  const pool = [
    { value: size.value, system: size.system },
    ...(size.alternatives ?? []),
  ];
  if (preferredSystem) {
    const hit = pool.find((t) => t.system === preferredSystem);
    if (hit) return `${hit.system} ${hit.value}`;
  }
  const labeled = pool.filter((t) => t.system);
  if (labeled.length === 0) return size.value;
  // A long same-system list (multi-size stock) reads as a range: "US 5.5–10.5".
  if (labeled.length > 3 && labeled.every((t) => t.system === labeled[0].system)) {
    const nums = labeled.map((t) => parseFloat(t.value.replace(",", ".")));
    if (nums.every((n) => !Number.isNaN(n))) {
      return `${labeled[0].system} ${Math.min(...nums)}–${Math.max(...nums)}`;
    }
  }
  return labeled.map((t) => `${t.system} ${t.value}`).join(" · ");
}
