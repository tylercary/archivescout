#!/usr/bin/env node
/**
 * Alert sweep + cron endpoint tests against the REAL Supabase project.
 *
 *   node scripts/test-alert-sweep-e2e.mjs [--base-url http://localhost:3000]
 *
 * Exercises the parts that only a live database can prove: the dedupe index,
 * RLS on the new tables, and the cron endpoint's auth. Cleans up after itself.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

const stamp = Date.now();
const userA = { email: `alert-a-${stamp}@example.com`, password: `Aa1!${stamp}aa` };
const userB = { email: `alert-b-${stamp}@example.com`, password: `Bb1!${stamp}bb` };

async function signIn(creds) {
  const c = createClient(URL_, ANON);
  const { error: upErr } = await c.auth.signUp(creds);
  if (upErr && !/already registered/i.test(upErr.message)) throw upErr;
  const { data, error } = await c.auth.signInWithPassword(creds);
  if (error) throw error;
  return { client: c, user: data.user };
}

async function main() {
  console.log(`alert sweep e2e — ${URL_}\n`);

  /* ── schema present? ── */
  console.log("━━ schema");
  const anon = createClient(URL_, ANON);
  // Prove the connection itself is good first, so a missing table below can
  // only mean the migration — not bad credentials or the wrong project.
  const { error: baseErr } = await anon.from("saved_searches").select("id").limit(1);
  check("connected (saved_searches reachable)", !baseErr, baseErr?.code ?? "");
  if (baseErr) {
    console.error("\n  Check NEXT_PUBLIC_SUPABASE_URL / ANON_KEY in .env.local.");
    return finish();
  }

  for (const table of ["saved_search_listing_snapshots", "saved_search_alert_events"]) {
    const { error } = await anon.from(table).select("id").limit(1);
    const missing = error?.code === "PGRST205";
    check(`${table} exists`, !missing, missing ? "PGRST205 — not in the schema cache" : "");
    if (missing) {
      console.error(
        [
          "",
          "  The table is not visible to the API. Two different causes:",
          "",
          "  1. The migration never committed. The Supabase SQL editor runs a",
          "     paste as ONE transaction, so an error anywhere rolls back",
          "     everything and leaves no trace. Re-paste",
          "     supabase/migrations/003_saved_search_alerts.sql — it now ends",
          "     with a SELECT that must return two rows. No rows = it rolled",
          "     back, and the editor's error is the real message.",
          "",
          "  2. It committed, but PostgREST is serving a stale schema cache.",
          "     Run:  notify pgrst, 'reload schema';",
          "",
        ].join("\n"),
      );
      return finish();
    }
  }

  /* ── anonymous access ── */
  console.log("\n━━ anonymous access");
  for (const table of ["saved_search_listing_snapshots", "saved_search_alert_events"]) {
    const { data } = await anon.from(table).select("*");
    check(`anonymous SELECT on ${table} returns nothing`, (data?.length ?? 0) === 0);
  }

  /* ── set up a saved search owned by A ── */
  console.log("\n━━ setup");
  const a = await signIn(userA);
  const b = await signIn(userB);
  check("two users signed in", Boolean(a.user?.id && b.user?.id));

  const { data: search, error: sErr } = await a.client
    .from("saved_searches")
    .insert({
      user_id: a.user.id,
      name: "Alert test",
      query: `alert-test-${stamp}`,
      marketplaces: ["ebay"],
      filters: {},
      sort: "recommended",
      is_notification_enabled: true,
      notification_types: ["new_listings", "price_drops"],
    })
    .select()
    .single();
  check("saved search created", Boolean(search?.id), sErr?.message ?? "");
  if (!search) return finish();

  /* ── dedupe index: the idempotency guarantee ── */
  console.log("\n━━ dedupe (idempotency)");
  const dedupeKey = `${search.id}:drop:ebay:item-1:450`;
  const eventRow = {
    saved_search_id: search.id,
    user_id: a.user.id,
    event_type: "price_drop",
    marketplace: "ebay",
    external_listing_id: "item-1",
    previous_price: 500,
    current_price: 450,
    currency: "USD",
    listing_snapshot: { title: "Test listing" },
    dedupe_key: dedupeKey,
  };
  // Users have no INSERT policy, so seed via the service role when available;
  // otherwise assert the browser genuinely cannot write.
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const writer = svcKey ? createClient(URL_, svcKey, { auth: { persistSession: false } }) : null;

  const { error: userInsertErr } = await a.client
    .from("saved_search_alert_events")
    .insert(eventRow);
  check(
    "a normal user CANNOT insert alert events",
    Boolean(userInsertErr),
    userInsertErr?.code ?? "NO ERROR — RLS GAP",
  );

  if (writer) {
    const { error: e1 } = await writer.from("saved_search_alert_events").insert(eventRow);
    check("service role can insert the event", !e1, e1?.message ?? "");
    const { error: e2 } = await writer.from("saved_search_alert_events").insert(eventRow);
    check("duplicate dedupe_key is rejected", e2?.code === "23505", e2?.code ?? "NO ERROR");
    // A deeper drop is a different key → allowed.
    const { error: e3 } = await writer
      .from("saved_search_alert_events")
      .insert({ ...eventRow, current_price: 425, dedupe_key: `${search.id}:drop:ebay:item-1:425` });
    check("a further price drop IS allowed", !e3, e3?.message ?? "");
  } else {
    console.log("  · SUPABASE_SERVICE_ROLE_KEY not set — skipping service-role writes");
  }

  /* ── cross-user isolation ── */
  console.log("\n━━ cross-user isolation");
  const { data: bEvents } = await b.client.from("saved_search_alert_events").select("*");
  check("user B sees none of A's events", (bEvents?.length ?? 0) === 0, `B sees ${bEvents?.length ?? 0}`);
  const { data: bById } = await b.client
    .from("saved_search_alert_events")
    .select("*")
    .eq("saved_search_id", search.id);
  check("user B cannot read A's events by search id", (bById?.length ?? 0) === 0);
  if (writer) {
    const { data: aEvents } = await a.client.from("saved_search_alert_events").select("*");
    check("user A CAN read their own events", (aEvents?.length ?? 0) >= 1, `A sees ${aEvents?.length ?? 0}`);
  }

  /* ── cron endpoint auth ── */
  console.log("\n━━ cron endpoint");
  const post = (headers) =>
    fetch(`${BASE}/api/cron/saved-search-alerts`, { method: "POST", headers });
  check("no credentials → 401", (await post({})).status === 401);
  check("wrong secret → 401", (await post({ Authorization: "Bearer nope" })).status === 401);

  const secret = process.env.ALERT_CRON_SECRET;
  if (secret) {
    const res = await post({ Authorization: `Bearer ${secret}` });
    const body = await res.json().catch(() => ({}));
    check(
      "correct secret is accepted (200 ready, or 503 when unconfigured)",
      res.status === 200 || res.status === 503,
      `status ${res.status} ${body.reason ?? ""}`,
    );
    check("503 response names only missing VARS, not values",
      res.status !== 503 || (Array.isArray(body.missing) && body.missing.every((m) => /^[A-Z_]+$/.test(m))),
      JSON.stringify(body.missing ?? []));
  } else {
    console.log("  · ALERT_CRON_SECRET not set — sweep cannot be triggered (expected pre-launch)");
  }

  /* ── cleanup ── */
  console.log("\n━━ cleanup");
  if (writer) {
    await writer.from("saved_search_alert_events").delete().eq("saved_search_id", search.id);
    await writer.from("saved_search_listing_snapshots").delete().eq("saved_search_id", search.id);
  }
  const { error: delErr } = await a.client.from("saved_searches").delete().eq("id", search.id);
  check("test saved search removed", !delErr, delErr?.message ?? "");

  finish();
}

function finish() {
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
