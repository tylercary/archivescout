#!/usr/bin/env node
/**
 * Unit tests for the seller-entered size-string parser + display formatter.
 * Runs the REAL TypeScript source (Node strips types natively):
 *
 *   node --experimental-strip-types scripts/test-size-parser.mjs
 */
import {
  parseSizeString,
  formatVerifiedSize,
} from "../lib/marketplaces/size-string-parser.ts";

const results = [];
function check(name, passed, detail = "") {
  results.push(passed);
  console.log(`  ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const j = (v) => JSON.stringify(v);

// ── the spec'd inputs ──────────────────────────────────────────────────

{
  const s = parseSizeString("EUR39=US8", "footwear", "US");
  check("EUR39=US8 → primary US 8", s.value === "8" && s.system === "US", j(s));
  check("EUR39=US8 → raw preserved", s.rawValue === "EUR39=US8");
  check(
    "EUR39=US8 → EU 39 captured as alternative",
    s.alternatives?.length === 1 &&
      s.alternatives[0].value === "39" &&
      s.alternatives[0].system === "EU",
    j(s.alternatives),
  );
  check("EUR39=US8 → no-preference display", formatVerifiedSize(s) === "US 8 · EU 39", formatVerifiedSize(s));
  check("EUR39=US8 → EU-filter display", formatVerifiedSize(s, "EU") === "EU 39", formatVerifiedSize(s, "EU"));
}

{
  const s = parseSizeString("EU 39 / US 8", "footwear");
  check("EU 39 / US 8 → US primary (EBAY_US)", s.value === "8" && s.system === "US", j(s));
  check("EU 39 / US 8 → alt EU 39", s.alternatives?.[0]?.value === "39" && s.alternatives[0].system === "EU");
}

{
  const s = parseSizeString("US13 (EU46)", "footwear", "US");
  check("US13 (EU46) → US 13", s.value === "13" && s.system === "US", j(s));
  check("US13 (EU46) → alt EU 46", s.alternatives?.[0]?.value === "46" && s.alternatives[0].system === "EU");
}

{
  const s = parseSizeString("UK 9 / US 10", "footwear");
  check("UK 9 / US 10 → US 10 primary", s.value === "10" && s.system === "US", j(s));
  check("UK 9 / US 10 → alt UK 9", s.alternatives?.[0]?.value === "9" && s.alternatives[0].system === "UK");
  check("UK-filter display → UK 9", formatVerifiedSize(s, "UK") === "UK 9");
}

{
  const s = parseSizeString("34 in", "waist");
  check("34 in → waist 34", s.value === "34", j(s));
  check("34 in → display '34', never a shoe size", formatVerifiedSize(s) === "34");
  check("34 in → raw preserved", s.rawValue === "34 in");
}

{
  const s = parseSizeString("W34 L32", "waist");
  check("W34 L32 → value 34", s.value === "34", j(s));
  check("W34 L32 → display W34 × L32", formatVerifiedSize(s) === "W34 × L32", formatVerifiedSize(s));
}

{
  const s = parseSizeString("Large / L", "clothing");
  check("Large / L → L", s.value === "L", j(s));
  check("Large / L → display 'L' (no Size Size)", formatVerifiedSize(s) === "L");
}

{
  const s = parseSizeString("Size Large (L)", "clothing");
  check("Size Large (L) → L", s.value === "L", j(s));
}

{
  const s = parseSizeString("One Size", "clothing");
  check("One Size → One Size", s.value === "One Size", j(s));
}

{
  const s = parseSizeString("Unknown", "clothing");
  check("Unknown → passes through, no crash", s.value === "Unknown", j(s));
  check("Unknown → no system invented", s.system === undefined);
}

// ── no fabricated conversions ─────────────────────────────────────────

{
  const s = parseSizeString("EU 39", "footwear");
  check("EU 39 alone → EU 39, nothing invented", s.value === "39" && s.system === "EU" && !s.alternatives, j(s));
  check("EU 39 alone → display 'EU 39'", formatVerifiedSize(s) === "EU 39");
  check("EU 39 alone under US filter → still EU 39 (no conversion)", formatVerifiedSize(s, "US") === "EU 39");
}

{
  const s = parseSizeString("39", "footwear");
  check("bare 39 → EU by non-overlapping range", s.system === "EU", j(s));
  const t = parseSizeString("Mens 10", "footwear");
  check("Mens 10 → US 10", t.value === "10" && t.system === "US", j(t));
  const u = parseSizeString("10M", "footwear");
  check("10M (medium width) → US 10", u.value === "10" && u.system === "US", j(u));
}

{
  const s = parseSizeString("5.5 / 6  / 6.5 / 7.5 / 8.5", "footwear", "US");
  check("multi-size list → primary 5.5, alternatives captured",
    s.value === "5.5" && s.system === "US" && s.alternatives?.length === 4, j(s));
  check("multi-size list → range display", formatVerifiedSize(s) === "US 5.5–8.5", formatVerifiedSize(s));
  check("multi-size raw preserved", s.rawValue === "5.5 / 6  / 6.5 / 7.5 / 8.5");
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} parser checks passed`);
process.exit(failed ? 1 : 0);
