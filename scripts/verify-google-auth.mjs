#!/usr/bin/env node
/**
 * Google Sign-In verification.
 *
 *   node scripts/verify-google-auth.mjs [--base-url http://localhost:3000]
 *
 * Covers what can be checked without a human at Google's consent screen:
 *   · the provider is enabled on the Supabase project
 *   · /auth/callback rejects EXTERNAL next destinations (open-redirect guard)
 *   · every OAuth failure mode lands on /signin with a readable reason
 *   · the safeNext validator itself (unit tests, real source)
 *   · email/password auth still works
 */
import { readFileSync } from "node:fs";
import { safeNext } from "../lib/auth/safe-next.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
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

async function main() {
  console.log(`google auth verification — ${BASE}\n`);

  /* ── 1. redirect safety (the security-critical part) ── */
  console.log("━━ open-redirect guard (safeNext)");
  const hostile = [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "http:/evil.example",
    "javascript:alert(1)",
    "%2F%2Fevil.example",
    "/path\nSet-Cookie: x=1",
  ];
  for (const h of hostile) {
    const got = safeNext(h, "/saved");
    check(`rejects ${JSON.stringify(h).slice(0, 34)}`, got === "/saved", `→ ${got}`);
  }
  const legit = ["/search?q=chanel+runners&save=1", "/searches", "/"];
  for (const l of legit) {
    check(`preserves ${l.slice(0, 34)}`, safeNext(l, "/saved") === l);
  }

  /* ── 2. provider enabled on the project ── */
  console.log("\n━━ Supabase provider");
  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(BASE + "/auth/callback")}`,
      { redirect: "manual", headers: { apikey: ANON } },
    );
    const loc = res.headers.get("location") ?? "";
    if (res.status >= 300 && res.status < 400 && /accounts\.google\.com/.test(loc)) {
      const u = new URL(loc);
      check("Google provider is enabled", true, "redirects to accounts.google.com");
      check(
        "requests only identity scopes",
        !/gmail|drive|calendar|contacts/i.test(u.searchParams.get("scope") ?? ""),
        u.searchParams.get("scope") ?? "(none)",
      );
      check("client_id is present", Boolean(u.searchParams.get("client_id")));
    } else {
      const body = await res.text();
      check(
        "Google provider is enabled",
        false,
        /provider is not enabled/i.test(body)
          ? "NOT ENABLED — Supabase → Authentication → Providers → Google"
          : `status ${res.status}`,
      );
    }
  } catch (err) {
    check("Google provider is enabled", false, String(err));
  }

  /* ── 3. callback error handling ── */
  console.log("\n━━ /auth/callback failure modes");
  const cases = [
    ["", "missing_code", "no code at all"],
    ["?error=access_denied", "cancelled", "user dismissed consent"],
    ["?code=totally-invalid-code", "exchange_failed", "bad/expired code"],
  ];
  for (const [qs, expected, label] of cases) {
    try {
      const res = await fetch(`${BASE}/auth/callback${qs}`, { redirect: "manual" });
      const loc = res.headers.get("location") ?? "";
      check(
        `${label} → /signin?error=${expected}`,
        loc.includes("/signin") && loc.includes(`error=${expected}`),
        loc.replace(BASE, "") || `status ${res.status}`,
      );
    } catch (err) {
      check(label, false, String(err));
    }
  }

  console.log("\n━━ /auth/callback refuses external destinations");
  try {
    const res = await fetch(
      `${BASE}/auth/callback?error=access_denied&next=${encodeURIComponent("https://evil.example")}`,
      { redirect: "manual" },
    );
    const loc = res.headers.get("location") ?? "";
    check(
      "external next is dropped",
      !loc.includes("evil.example"),
      loc.replace(BASE, ""),
    );
  } catch (err) {
    check("external next is dropped", false, String(err));
  }

  /* ── 4. email/password still works ── */
  console.log("\n━━ email/password regression");
  const stamp = Date.now();
  const creds = { email: `g-${stamp}@example.com`, password: `Aa1!${stamp}zz` };
  try {
    const up = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    });
    check("email sign-up still works", up.ok, up.ok ? "" : `status ${up.status}`);
    const inn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    });
    const tok = await inn.json();
    check("email sign-in still works", Boolean(tok.access_token));
  } catch (err) {
    check("email/password", false, String(err));
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
