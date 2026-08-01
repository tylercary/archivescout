#!/usr/bin/env node
/**
 * Cross-marketplace size-filter correctness regression tests.
 *
 *   node scripts/test-filter-invariants.mjs [--base-url http://localhost:3000]
 *
 * Runs against a LIVE app (real eBay + Grailed), asserting the invariants
 * from the "handbags under footwear size 13" bug:
 *   1. chanel runners + footwear:13  → footwear only, no bags, size 13 or none
 *   2. chanel handbags + footwear:13 → zero eBay bags relabeled as size 13
 *   3. carhartt double knee + waist:34 → bottoms only, waist 34 verified
 *   4. patagonia jacket + clothing:l  → clothing only, size L verified
 *   5. variants preserve the filter; Load More preserves it; no dup ids;
 *      clearing size broadens results.
 */

const FOOTWEAR = /\b(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|heel|heels|sandal|sandals|loafer|loafers|flat|flats|mule|mules|slide|slides|cleat|cleats|slipper|slippers|footwear|espadrille|oxford|derby|pump|pumps|runner|runners|slip[- ]?ons?)\b/i;
const WAIST = /\b(jean|jeans|pant|pants|trouser|trousers|short|shorts|bottom|bottoms|chino|chinos|denim|overall|overalls|jumpsuit|jumpsuits|legging|leggings|sweatpant|sweatpants|jogger|joggers)\b/i;
const CLOTHING = /\b(shirt|shirts|t-shirt|tee|tees|top|tops|jacket|jackets|coat|coats|sweater|sweaters|sweatshirt|sweatshirts|hoodie|hoodies|knitwear|blazer|blazers|vest|vests|outerwear|dress|dresses|cardigan|polo|polos|fleece|parka|parkas|windbreaker|clothing|skirt|skirts|blouse|blouses|jersey|jerseys)\b/i;
const NON_GARMENT = /\b(bag|bags|handbag|handbags|wallet|wallets|purse|purses|backpack|backpacks|luggage|jewelry|jewellery|necklace|bracelet|ring|rings|earring|earrings|watch|watches|scarf|scarves|belt|belts|hat|hats|cap|caps|beanie|sunglasses|eyewear|glasses|accessor\w*|keychain|book|books|magazine|perfume|fragrance|cosmetic|lace|laces|insole|insoles|care|cleaner|poster|sticker|figure|toy|toys)\b/i;

function family(category) {
  if (!category) return undefined;
  if (NON_GARMENT.test(category)) return null;
  if (FOOTWEAR.test(category)) return "footwear";
  if (WAIST.test(category)) return "waist";
  if (CLOTHING.test(category)) return "clothing";
  return undefined;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BASE = arg("--base-url", "http://localhost:3000").replace(/\/$/, "");

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`  ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function search(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${BASE}/api/search?${qs}`);
  if (!res.ok) throw new Error(`search ${qs} -> HTTP ${res.status}`);
  return res.json();
}

const sizeMatches = (listing, value, type) => {
  if (!listing.size) return true; // undefined allowed; NEVER a copied value
  const have = String(listing.size).toLowerCase().replace(/\s*in$/, "");
  if (have === value) return true;
  if (type === "waist") {
    const wx = have.match(/^(\d{2})\s?x\s?\d{2}$/);
    if (wx && wx[1] === value) return true;
  }
  return false;
};

async function assertCase(label, params, type, value, { allowUnknownFamilyFor = ["grailed"] } = {}) {
  console.log(`\n━━ ${label}`);
  const d = await search(params);
  const ids = d.listings.map((l) => l.id);
  check("no duplicate ids", ids.length === new Set(ids).size);

  const badFamily = d.listings.filter((l) => {
    const fam = family(l.category);
    if (fam === null) return true; // bags/accessories: never valid
    if (fam === undefined)
      return !allowUnknownFamilyFor.includes(l.marketplace);
    return fam !== type;
  });
  check(
    `every listing is ${type} (no bags/accessories)`,
    badFamily.length === 0,
    badFamily.slice(0, 2).map((l) => `${l.marketplace}:${l.category}`).join(", "),
  );

  const badSize = d.listings.filter((l) => !sizeMatches(l, value, type));
  check(
    `sizes are verified ${value} or absent (never copied)`,
    badSize.length === 0,
    badSize.slice(0, 2).map((l) => `${l.marketplace}:${l.size}`).join(", "),
  );

  // Load More (page 2) preserves everything
  const d2 = await search({ ...params, page: "2" });
  const ids2 = d2.listings.map((l) => l.id);
  check("Load More: no duplicate ids", ids2.length === new Set(ids2).size);
  const bad2 = d2.listings.filter(
    (l) => family(l.category) === null || !sizeMatches(l, value, type),
  );
  check("Load More preserves the size filter", bad2.length === 0);
  return d;
}

async function main() {
  console.log(`filter-invariant tests against ${BASE}`);

  // 1. the original bug
  const d1 = await assertCase(
    "chanel runners + footwear US 13",
    { q: "chanel runners", sizes: "footwear:13" },
    "footwear",
    "13",
  );

  // 2. handbags query + footwear filter: no relabeled bags
  console.log(`\n━━ chanel handbags + footwear:13`);
  const dBags = await search({ q: "chanel handbags", sizes: "footwear:13" });
  const relabeled = dBags.listings.filter(
    (l) => family(l.category) === null && String(l.size ?? "") === "13",
  );
  check("no handbag relabeled as size-13 footwear", relabeled.length === 0);
  const bagsInResults = dBags.listings.filter((l) => family(l.category) === null);
  const ebayStatus = dBags.marketplaceStatus.find((s) => s.marketplace === "ebay");
  check(
    "eBay: zero bags OR marked unsupported",
    bagsInResults.filter((l) => l.marketplace === "ebay").length === 0 ||
      Boolean(ebayStatus?.unsupportedFilters?.length),
    `bags=${bagsInResults.length} unsupported=${JSON.stringify(ebayStatus?.unsupportedFilters)}`,
  );

  // 3 + 4. other families
  await assertCase(
    "carhartt double knee + waist 34",
    { q: "carhartt double knee", sizes: "waist:34" },
    "waist",
    "34",
  );
  await assertCase(
    "patagonia jacket + clothing L",
    { q: "patagonia jacket", sizes: "clothing:l" },
    "clothing",
    "l",
  );

  // 5. variant queries preserve the filter ("chanel running" fans out)
  await assertCase(
    "variants: chanel running + footwear:13",
    { q: "chanel running", sizes: "footwear:13" },
    "footwear",
    "13",
  );

  // 6. clearing the size restores broad results
  console.log(`\n━━ clearing the size filter`);
  const broad = await search({ q: "chanel runners" });
  check(
    "clearing size broadens results",
    broad.listings.length >= d1.listings.length,
    `${d1.listings.length} -> ${broad.listings.length}`,
  );

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
