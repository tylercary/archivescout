#!/usr/bin/env node
/**
 * Saved-search serialization round-trip tests.
 *
 *   node --experimental-strip-types scripts/test-saved-search-serializer.mjs
 *
 * Proves, against the REAL source:
 *   search state → saved payload → restored URL → identical normalized state
 * plus: pagination is never stored, no marketplace syntax leaks, and search
 * identity distinguishes searches that differ by any filter.
 */
import { parseSearchParams, toQueryString } from "../lib/search/params.ts";
import {
  toSavedSearchPayload,
  fromSavedSearchPayload,
  toSearchUrl,
  searchIdentity,
  isSameSearch,
  describeSearch,
  defaultSearchName,
} from "../lib/saved-searches/serializer.ts";

const results = [];
function check(name, passed, detail = "") {
  results.push(passed);
  console.log(`  ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const parse = (qs) => parseSearchParams(new URLSearchParams(qs));
const norm = (p) => ({
  query: p.query,
  marketplaces: [...p.marketplaces].sort(),
  filters: p.filters,
  sort: p.sort,
});
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── the cases the spec names, plus the awkward ones ── */
const CASES = [
  ["plain query", "q=chanel+runners"],
  ["typed size + trust", "q=chanel+runners&sizes=footwear%3A13&trust=guarantee"],
  ["waist + condition + price", "q=carhartt+double+knee&sizes=waist%3A34&conditions=Good&maxPrice=500"],
  ["clothing size + brand + dept", "q=jacket&sizes=clothing%3Al&brands=Patagonia&genders=Menswear"],
  ["single marketplace + sort", "q=jordan+4&markets=ebay&sort=price_asc"],
  ["multi trust + color + location", "q=nike&trust=guarantee%2Ctrusted&colors=Black&locations=United+States"],
  ["category + free shipping", "q=levis&categories=Denim&freeShipping=1"],
  ["price range both ends", "q=gucci&minPrice=100&maxPrice=900"],
  ["empty query, filters only", "brands=Chanel&sizes=footwear%3A10"],
];

console.log("saved-search serializer round-trip\n");

for (const [label, qs] of CASES) {
  const original = parse(qs);
  const payload = toSavedSearchPayload(original);
  const restored = parse(toQueryString(fromSavedSearchPayload(payload)));
  check(
    `round-trip: ${label}`,
    eq(norm(original), norm(restored)),
    eq(norm(original), norm(restored))
      ? ""
      : `\n      before=${JSON.stringify(norm(original))}\n      after =${JSON.stringify(norm(restored))}`,
  );
}

console.log("\n━━ pagination is view state, never stored");
{
  const deep = parse("q=chanel&sizes=footwear%3A13&page=5&perPage=48");
  const payload = toSavedSearchPayload(deep);
  check("payload has no page/perPage keys", !("page" in payload) && !("perPage" in payload));
  const restored = fromSavedSearchPayload(payload);
  check("restores at page 1", restored.page === 1, `page=${restored.page}`);
  check("restored URL carries no page param", !toSearchUrl(payload).includes("page="), toSearchUrl(payload));
  const shallow = toSavedSearchPayload(parse("q=chanel&sizes=footwear%3A13"));
  check("page-5 and page-1 are the SAME saved search", isSameSearch(payload, shallow));
}

console.log("\n━━ marketplace-neutral (no provider syntax leaks)");
{
  const payload = toSavedSearchPayload(parse("q=chanel+runners&sizes=footwear%3A13&trust=guarantee"));
  const blob = JSON.stringify(payload);
  const leaks = [
    "aspect_filter", "categoryId", "qualifiedPrograms", "US Shoe Size",
    "category_size", "facetFilters", "numericFilters", "deliveryPostalCode",
  ].filter((s) => blob.includes(s));
  check("no eBay/Grailed syntax in the payload", leaks.length === 0, leaks.join(", "));
  check("filters are the normalized model", Array.isArray(payload.filters.sizeFilters) &&
    payload.filters.sizeFilters[0].type === "footwear");
}

console.log("\n━━ search identity distinguishes refinements");
{
  const a = toSavedSearchPayload(parse("q=chanel+runners"));
  const b = toSavedSearchPayload(parse("q=chanel+runners&sizes=footwear%3A13"));
  const c = toSavedSearchPayload(parse("q=chanel+runners&sizes=footwear%3A13&trust=guarantee"));
  check("query vs +size differ", searchIdentity(a) !== searchIdentity(b));
  check("+size vs +size+trust differ", searchIdentity(b) !== searchIdentity(c));
  check("identical searches match", isSameSearch(b, toSavedSearchPayload(parse("q=chanel+runners&sizes=footwear%3A13"))));
  // Param ORDER must not affect identity.
  const reordered = toSavedSearchPayload(parse("sizes=footwear%3A13&q=chanel+runners"));
  check("param order does not change identity", isSameSearch(b, reordered));
  // Marketplace order must not either.
  const m1 = toSavedSearchPayload(parse("q=nike&markets=ebay,grailed"));
  const m2 = toSavedSearchPayload(parse("q=nike&markets=grailed,ebay"));
  check("marketplace order does not change identity", isSameSearch(m1, m2));
}

console.log("\n━━ human summary (no raw keys)");
{
  const payload = toSavedSearchPayload(
    parse("q=chanel+runners&sizes=footwear%3A13&maxPrice=900&trust=guarantee&markets=ebay,grailed"),
  );
  const rows = describeSearch(payload);
  const flat = rows.map((r) => `${r.label}: ${r.value}`);
  check("summarises query verbatim (not retitled)", flat[0] === "Query: chanel runners", flat[0]);
  check("marketplaces are display names", flat.some((r) => r === "Marketplaces: eBay, Grailed"));
  check("typed size reads naturally", flat.some((r) => /^Shoe size: US 13$/.test(r)), flat.find((r) => /Shoe size/.test(r)));
  check("price reads naturally", flat.some((r) => r === "Price: Under $900"));
  check("trust reads naturally", flat.some((r) => r === "Trust: Authenticity Guarantee"));
  check(
    "no raw internal keys leak",
    !flat.some((r) => /sizeFilters|maxPrice|footwear:|trust=|freeShipping/.test(r)),
    flat.join(" | "),
  );
  check("default name derived from query + refinement",
    defaultSearchName(payload) === "Chanel Runners · US 13", defaultSearchName(payload));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
