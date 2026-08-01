#!/usr/bin/env node
/**
 * Supabase auth + Row Level Security verification against the REAL project.
 *
 *   node scripts/verify-supabase.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from
 * .env.local (or the environment) and exercises the actual database with the
 * ANON key only — exactly the privileges a browser has.
 *
 * Proves, for `saved_searches`:
 *   · anonymous users cannot read or write
 *   · a signed-in user can CRUD only their OWN rows
 *   · user B cannot read, update, or delete user A's row even knowing its id
 *   · inserting with someone else's user_id is rejected
 *
 * Creates two throwaway users (…@archivescout-test.com) and deletes its
 * own rows afterwards. It never uses a service-role key — if RLS is wrong,
 * these tests fail rather than silently passing with elevated privileges.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* ── config ── */
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch {
  /* env may come from the shell instead */
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function configError(lines) {
  console.error(["Supabase config problem:", ...lines.map((l) => `  ${l}`)].join("\n"));
  console.error(
    "\nWhere to find the real values:\n" +
      "  supabase.com → your project → Settings → API\n" +
      "    Project URL   → NEXT_PUBLIC_SUPABASE_URL   (e.g. https://abcdefghijkl.supabase.co)\n" +
      "    publishable   → NEXT_PUBLIC_SUPABASE_ANON_KEY ('sb_publishable_…', or legacy 'eyJ…')",
  );
  process.exit(2);
}

if (!URL_ || !ANON) {
  configError([
    "NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set in .env.local.",
  ]);
}
// Placeholder text copied verbatim from docs is the most common failure —
// catch it explicitly rather than dying inside the Supabase client.
const placeholder = (v) => /[<>]/.test(v) || /your-|project-ref|anon public key|example\.com/i.test(v);
if (placeholder(URL_) || placeholder(ANON)) {
  configError([
    "The values look like PLACEHOLDER text, not real credentials:",
    `    NEXT_PUBLIC_SUPABASE_URL      = ${URL_}`,
    `    NEXT_PUBLIC_SUPABASE_ANON_KEY = ${ANON.slice(0, 24)}${ANON.length > 24 ? "…" : ""}`,
    "Replace them with your project's actual values (no angle brackets).",
  ]);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(URL_.replace(/\/$/, ""))) {
  configError([
    `NEXT_PUBLIC_SUPABASE_URL doesn't look like a Supabase project URL: ${URL_}`,
    "Expected the form https://<something>.supabase.co",
  ]);
}
// Reject anything that bypasses RLS. Supabase has two generations of keys:
//   legacy:  anon JWT ("eyJ…")            vs  service_role JWT
//   current: publishable ("sb_publishable_…") vs secret ("sb_secret_…")
// Only the browser-safe halves belong in a NEXT_PUBLIC_ var.
if (/service_role/i.test(ANON) || ANON.startsWith("sb_secret_")) {
  configError([
    "That is a SECRET/SERVICE-ROLE key — it bypasses Row Level Security.",
    "Never put it in a NEXT_PUBLIC_ var; use the publishable (or anon) key instead.",
  ]);
}
if (!ANON.startsWith("eyJ") && !ANON.startsWith("sb_publishable_")) {
  configError([
    "NEXT_PUBLIC_SUPABASE_ANON_KEY doesn't look like a Supabase browser key.",
    "Expected 'sb_publishable_…' (current) or 'eyJ…' (legacy anon).",
  ]);
}

const results = [];
function check(name, passed, detail = "") {
  results.push(passed);
  console.log(`  ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const anonClient = () => createClient(URL_, ANON);
const stamp = Date.now();
const userA = { email: `a-${stamp}@archivescout-test.com`, password: `Aa1!${stamp}aa` };
const userB = { email: `b-${stamp}@archivescout-test.com`, password: `Bb1!${stamp}bb` };

async function signUpAndIn(client, creds) {
  const { error: upErr } = await client.auth.signUp(creds);
  if (upErr && !/already registered/i.test(upErr.message)) throw upErr;
  const { data, error } = await client.auth.signInWithPassword(creds);
  if (error) {
    throw new Error(
      `${error.message}${
        /confirm/i.test(error.message)
          ? " — disable 'Confirm email' in Supabase → Authentication → Providers → Email, or confirm the address"
          : ""
      }`,
    );
  }
  return data.user;
}

const SEARCH = {
  query: "chanel runners",
  marketplaces: ["ebay", "grailed"],
  filters: { sizes: ["13"], trust: ["guarantee"] },
  sort: "recommended",
};

async function main() {
  console.log(`verifying ${URL_}\n`);

  /* ── PHASE 0: the table must actually exist ──
   * PGRST205 means "table not in schema cache" — i.e. the SQL was never run.
   * That is NOT RLS working; treating it as a pass would report a green suite
   * against a database with no tables. Fail loudly and stop. */
  console.log("━━ schema");
  const anon = anonClient();
  const probe = await anon.from("saved_searches").select("id").limit(1);
  if (probe.error?.code === "PGRST205") {
    check("saved_searches table exists", false, "PGRST205 — table not found");
    console.error(
      "\nThe database schema has not been created. In the Supabase dashboard:\n" +
        "  SQL Editor → New query → run supabase/schema.sql\n" +
        "  then a new query → run supabase/migrations/002_saved_searches_alerts.sql\n" +
        "  (order matters — the migration alters the table the schema creates)",
    );
    return finish();
  }
  check("saved_searches table exists", true);

  /* ── PHASE 1: anonymous access must be denied ── */
  console.log("\n━━ anonymous access");
  const { data: anonRead, error: anonReadErr } = await anon.from("saved_searches").select("*");
  check(
    "anonymous SELECT returns no rows",
    (anonRead?.length ?? 0) === 0 && anonReadErr?.code !== "PGRST205",
    anonReadErr ? `blocked: ${anonReadErr.code}` : `rows=${anonRead?.length ?? 0}`,
  );
  const { error: anonWriteErr } = await anon
    .from("saved_searches")
    .insert({ ...SEARCH, user_id: "00000000-0000-0000-0000-000000000000" });
  check("anonymous INSERT is rejected", Boolean(anonWriteErr), anonWriteErr?.code ?? "NO ERROR — RLS GAP");

  /* ── PHASE 2: auth ── */
  console.log("\n━━ authentication");
  const clientA = anonClient();
  const clientB = anonClient();
  let a, b;
  try {
    a = await signUpAndIn(clientA, userA);
    check("user A sign-up + sign-in", Boolean(a?.id), a?.email);
    b = await signUpAndIn(clientB, userB);
    check("user B sign-up + sign-in", Boolean(b?.id), b?.email);
  } catch (err) {
    check("sign-up / sign-in", false, err.message);
    return finish();
  }
  const { data: sessionA } = await clientA.auth.getSession();
  check("session has an access token", Boolean(sessionA.session?.access_token));
  const { data: userCheck } = await clientA.auth.getUser();
  check("getUser() confirms identity server-side", userCheck.user?.id === a.id);

  /* ── PHASE 3: owner CRUD ── */
  console.log("\n━━ owner CRUD (user A)");
  const { data: created, error: createErr } = await clientA
    .from("saved_searches")
    .insert({ ...SEARCH, user_id: a.id, name: "Chanel Runners · US 13" })
    .select()
    .single();
  check("INSERT own row", Boolean(created?.id), createErr?.message ?? "");
  if (!created) return finish();

  const { data: listed } = await clientA.from("saved_searches").select("*");
  check("SELECT returns own row", listed?.some((r) => r.id === created.id) === true);

  const { error: updErr } = await clientA
    .from("saved_searches")
    .update({ name: "Renamed", is_notification_enabled: true, notification_types: ["new_listings"] })
    .eq("id", created.id);
  check("UPDATE own row", !updErr, updErr?.message ?? "");

  const { data: afterUpd } = await clientA.from("saved_searches").select("*").eq("id", created.id).single();
  check("rename persisted", afterUpd?.name === "Renamed", afterUpd?.name);
  check("notification prefs persisted",
    afterUpd?.is_notification_enabled === true && afterUpd?.notification_types?.includes("new_listings"));
  check("updated_at trigger fired", afterUpd && afterUpd.updated_at !== afterUpd.created_at);

  /* ── PHASE 4: cross-user isolation ── */
  console.log("\n━━ cross-user isolation (user B vs A's row)");
  const { data: bReadsAll } = await clientB.from("saved_searches").select("*");
  check("B's list excludes A's rows", !bReadsAll?.some((r) => r.id === created.id), `B sees ${bReadsAll?.length ?? 0}`);

  const { data: bGuess } = await clientB.from("saved_searches").select("*").eq("id", created.id);
  check("B cannot read A's row by id", (bGuess?.length ?? 0) === 0);

  const { data: bUpd } = await clientB
    .from("saved_searches").update({ name: "hacked" }).eq("id", created.id).select();
  check("B cannot update A's row", (bUpd?.length ?? 0) === 0);

  const { data: bDel } = await clientB
    .from("saved_searches").delete().eq("id", created.id).select();
  check("B cannot delete A's row", (bDel?.length ?? 0) === 0);

  const { error: spoofErr } = await clientB
    .from("saved_searches").insert({ ...SEARCH, user_id: a.id });
  check("B cannot insert a row owned by A", Boolean(spoofErr), spoofErr?.code ?? "NO ERROR — RLS GAP");

  const { data: stillThere } = await clientA.from("saved_searches").select("name").eq("id", created.id).single();
  check("A's row survived B's attempts unchanged", stillThere?.name === "Renamed", stillThere?.name);

  /* ── PHASE 5: duplicate identity ── */
  console.log("\n━━ duplicate protection");
  const { error: dupErr } = await clientA.from("saved_searches").insert({ ...SEARCH, user_id: a.id });
  check("identical search is rejected by the uniqueness index", Boolean(dupErr), dupErr?.code ?? "NO ERROR");

  /* ── cleanup ── */
  console.log("\n━━ cleanup");
  const { error: delErr } = await clientA.from("saved_searches").delete().eq("id", created.id);
  check("DELETE own row", !delErr, delErr?.message ?? "");
  const { data: after } = await clientA.from("saved_searches").select("*").eq("id", created.id);
  check("row is gone", (after?.length ?? 0) === 0);

  finish();
}

function finish() {
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) {
    console.log("\nA failure above means RLS is not protecting the table. Do NOT ship until it passes.");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
