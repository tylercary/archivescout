#!/usr/bin/env node
/**
 * Authentication filter regression tests (live app).
 *
 *   node scripts/test-authentication.mjs [--base-url http://localhost:3000]
 */
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BASE = arg("--base-url", "http://localhost:3000").replace(/\/$/, "");

const results = [];
function check(name, passed, detail = "") {
  results.push(passed);
  console.log(`  ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const search = async (params) => {
  const res = await fetch(`${BASE}/api/search?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`search -> ${res.status}`);
  return res.json();
};

async function main() {
  console.log(`authentication tests against ${BASE}`);

  console.log(`\n━━ jordan 4 + Authenticated Only`);
  const d = await search({ q: "jordan 4", trust: "guarantee" });
  const eb = d.listings.filter((l) => l.marketplace === "ebay");
  const gr = d.listings.filter((l) => l.marketplace === "grailed");
  check(
    "every eBay listing is officially covered",
    eb.length > 0 &&
      eb.every(
        (l) =>
          l.authenticated === true &&
          l.authenticationSource === "ebay" &&
          l.authenticationType === "authenticity_guarantee",
      ),
    `ebay=${eb.length}`,
  );
  check("no Grailed listings slip through (unsupported)", gr.length === 0);
  const grStatus = d.marketplaceStatus.find((s) => s.marketplace === "grailed");
  check(
    "Grailed reports the filter unavailable",
    Boolean(grStatus?.unsupportedFilters?.includes("trust")),
    JSON.stringify(grStatus?.unsupportedFilters),
  );

  console.log(`\n━━ pagination + Load More preserve the filter`);
  const d2 = await search({ q: "jordan 4", trust: "guarantee", page: "2" });
  const eb2 = d2.listings.filter((l) => l.marketplace === "ebay");
  const ids2 = d2.listings.map((l) => l.id);
  check("page 2: still authenticated-only", eb2.every((l) => l.authenticated === true));
  check("page 2: grew (Load More works)", d2.listings.length > d.listings.length,
    `${d.listings.length} -> ${d2.listings.length}`);
  check("page 2: no duplicate ids", ids2.length === new Set(ids2).size);

  console.log(`\n━━ removing the filter restores all listings`);
  const broad = await search({ q: "jordan 4" });
  check(
    "broader without the filter",
    broad.listings.length >= d.listings.length &&
      broad.listings.some((l) => l.marketplace === "grailed"),
    `${d.listings.length} -> ${broad.listings.length}`,
  );
  check(
    "no badge data on unsupported (Grailed) listings",
    broad.listings
      .filter((l) => l.marketplace === "grailed")
      .every((l) => l.authenticated === undefined),
  );

  console.log(`\n━━ query variants preserve the filter`);
  const dv = await search({ q: "jordan running", trust: "guarantee" });
  check(
    "variant-expanded query: authenticated-only holds",
    dv.listings
      .filter((l) => l.marketplace === "ebay")
      .every((l) => l.authenticated === true),
    `listings=${dv.listings.length}`,
  );

  console.log(`\n━━ detail (Quick View) carries authentication`);
  const target = eb[0];
  if (target) {
    const res = await fetch(
      `${BASE}/api/listings/ebay/${encodeURIComponent(target.externalId)}`,
    );
    const det = await res.json();
    check(
      "detail keeps authenticated + source + type",
      det.authenticated === true &&
        det.authenticationSource === "ebay" &&
        det.authenticationType === "authenticity_guarantee",
      JSON.stringify({ a: det.authenticated, s: det.authenticationSource }),
    );
  }

  console.log(`\n━━ auth + size combined`);
  const dc = await search({ q: "jordan 4", trust: "guarantee", sizes: "footwear:10" });
  const ebc = dc.listings.filter((l) => l.marketplace === "ebay");
  check(
    "authenticated AND size-filtered coexist",
    ebc.every((l) => l.authenticated === true &&
      (!l.size || String(l.size).toLowerCase().startsWith("10"))),
    `ebay=${ebc.length}`,
  );

  console.log(`\n━━ trusted seller`);
  const dt = await search({ q: "chanel", trust: "trusted" });
  check(
    "every listing has a verified seller",
    dt.listings.length > 0 && dt.listings.every((l) => l.sellerVerified === true),
    `listings=${dt.listings.length}`,
  );
  check(
    "both marketplaces can participate",
    new Set(dt.listings.map((l) => l.marketplace)).size >= 1,
    [...new Set(dt.listings.map((l) => l.marketplace))].join(","),
  );

  console.log(`\n━━ OR semantics + legacy URL`);
  const dor = await search({ q: "jordan 4", trust: "guarantee,trusted" });
  check(
    "guarantee OR trusted: every listing satisfies at least one",
    dor.listings.every(
      (l) => l.authenticationType === "authenticity_guarantee" || l.sellerVerified === true,
    ),
    `listings=${dor.listings.length}`,
  );
  const legacy = await search({ q: "jordan 4", auth: "1" });
  check(
    "legacy ?auth=1 still resolves to the guarantee filter",
    legacy.listings.filter((l) => l.marketplace === "ebay").every((l) => l.authenticated === true),
  );

  console.log(`\n━━ unsupported-only selection`);
  const dun = await search({ q: "chanel", trust: "authenticated" });
  check(
    "authenticated-only: no marketplace supports it, nothing silently returned",
    dun.listings.length === 0 &&
      dun.marketplaceStatus.some((s) => s.unsupportedFilters?.includes("trust")),
    `listings=${dun.listings.length}`,
  );

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
