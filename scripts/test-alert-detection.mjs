#!/usr/bin/env node
/**
 * Alert-detection unit tests — the rules that decide whether a human gets an
 * email. Runs the real TypeScript source.
 *
 *   node --experimental-strip-types scripts/test-alert-detection.mjs
 */
import { detectEvents } from "../lib/saved-searches/alert-detection.ts";
import {
  renderAlertEmail,
  alertSubject,
  NoopDeliveryProvider,
} from "../lib/saved-searches/alert-delivery.ts";

const results = [];
function check(name, passed, detail = "") {
  results.push(passed);
  console.log(`  ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const SEARCH = "search-1";
const BOTH = ["new_listings", "price_drops"];
const listing = (id, price, currency = "USD", marketplace = "ebay") => ({
  marketplace,
  externalId: id,
  price,
  currency,
});
const snap = (id, last, notified = null, currency = "USD", marketplace = "ebay") => ({
  marketplace,
  external_listing_id: id,
  last_price: last,
  currency,
  last_notified_price: notified,
});

/* ── baseline ── */
console.log("━━ first sweep (baseline)");
{
  const r = detectEvents(SEARCH, [listing("a", 500), listing("b", 300)], [], BOTH);
  check("no events on the very first sweep", r.events.length === 0, `events=${r.events.length}`);
  check("reports baseline=true", r.baseline === true);
}

/* ── new listings ── */
console.log("\n━━ new listing detection");
{
  const r = detectEvents(SEARCH, [listing("a", 500), listing("b", 300)], [snap("a", 500, 500)], BOTH);
  check("unseen listing produces one new_listing", r.events.length === 1 && r.events[0].type === "new_listing");
  check("it is the unseen id", r.events[0]?.externalId === "b");
  check("dedupe key is stable", r.events[0]?.dedupeKey === `${SEARCH}:new:ebay:b`);
}
{
  const r = detectEvents(SEARCH, [listing("a", 500)], [snap("a", 500, 500)], BOTH);
  check("already-seen listing produces nothing", r.events.length === 0);
}
{
  // Same id on a different marketplace is a DIFFERENT listing.
  const r = detectEvents(SEARCH, [listing("a", 500, "USD", "grailed")], [snap("a", 500, 500, "USD", "ebay")], BOTH);
  check("same id on another marketplace counts as new", r.events.length === 1, r.events[0]?.marketplace);
}

/* ── price drops ── */
console.log("\n━━ price-drop detection");
{
  const r = detectEvents(SEARCH, [listing("a", 450)], [snap("a", 500, 500)], BOTH);
  check("500 → 450 alerts once", r.events.length === 1 && r.events[0].type === "price_drop");
  check("carries both prices", r.events[0]?.previousPrice === 500 && r.events[0]?.currentPrice === 450);
  check("dedupe key includes the price", r.events[0]?.dedupeKey === `${SEARCH}:drop:ebay:a:450`);
}
{
  // Next sweep, still 450, already notified at 450.
  const r = detectEvents(SEARCH, [listing("a", 450)], [snap("a", 450, 450)], BOTH);
  check("unchanged price does NOT re-alert", r.events.length === 0);
}
{
  const r = detectEvents(SEARCH, [listing("a", 425)], [snap("a", 450, 450)], BOTH);
  check("450 → 425 alerts again", r.events.length === 1 && r.events[0].currentPrice === 425);
  check("new dedupe key for the deeper drop", r.events[0]?.dedupeKey === `${SEARCH}:drop:ebay:a:425`);
}
{
  const r = detectEvents(SEARCH, [listing("a", 600)], [snap("a", 500, 500)], BOTH);
  check("price INCREASE never alerts", r.events.length === 0);
}
{
  const r = detectEvents(SEARCH, [listing("a", 400, "EUR")], [snap("a", 500, 500, "USD")], BOTH);
  check("cross-currency comparison is skipped", r.events.length === 0, "EUR 400 vs USD 500");
}

/* ── respecting user preferences ── */
console.log("\n━━ notification type preferences");
{
  const r = detectEvents(SEARCH, [listing("b", 300)], [snap("a", 500, 500)], ["price_drops"]);
  check("new listings suppressed when only price_drops enabled", r.events.length === 0);
}
{
  const r = detectEvents(SEARCH, [listing("a", 450)], [snap("a", 500, 500)], ["new_listings"]);
  check("price drops suppressed when only new_listings enabled", r.events.length === 0);
}
{
  const r = detectEvents(SEARCH, [listing("a", 450), listing("b", 300)], [snap("a", 500, 500)], []);
  check("no types enabled produces nothing", r.events.length === 0);
}

/* ── digest rendering ── */
console.log("\n━━ digest email");
{
  const email = {
    to: "u@example.com",
    newCount: 1,
    dropCount: 1,
    sections: [
      {
        savedSearchName: "Chanel Runners · US 13",
        searchUrl: "https://archivescout.vercel.app/search?q=chanel+runners",
        listings: [
          {
            title: "Chanel CC Runner",
            marketplace: "ebay",
            imageUrl: "https://i.ebayimg.com/x.jpg",
            listingUrl: "https://ebay.com/itm/1",
            currency: "USD",
            price: 450,
            previousPrice: 500,
            eventType: "price_drop",
          },
          {
            title: "Chanel Runner Suede",
            marketplace: "grailed",
            listingUrl: "https://grailed.com/listings/2",
            currency: "USD",
            price: 300,
            eventType: "new_listing",
          },
        ],
      },
    ],
  };
  const html = renderAlertEmail(email);
  check("subject summarises both signals", /1 new/.test(alertSubject(email)) && /1 price drop/.test(alertSubject(email)), alertSubject(email));
  check("includes the saved-search name", html.includes("Chanel Runners"));
  check("includes both listing links", html.includes("ebay.com/itm/1") && html.includes("grailed.com/listings/2"));
  check("shows old and new price for the drop", html.includes("$500") && html.includes("$450"));
  check("includes the ArchiveScout search link", html.includes("/search?q=chanel+runners"));
  check("includes the image", html.includes("i.ebayimg.com/x.jpg"));

  const evil = {
    ...email,
    sections: [{ ...email.sections[0], savedSearchName: '<script>alert(1)</script>' }],
  };
  check("escapes HTML in user-controlled names", !renderAlertEmail(evil).includes("<script>"));
}
{
  const provider = new NoopDeliveryProvider();
  check("noop provider records instead of sending", provider.sent.length === 0);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
