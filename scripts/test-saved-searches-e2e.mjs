#!/usr/bin/env node
/**
 * Saved-searches end-to-end tests against the running app + real Supabase.
 *
 *   node scripts/test-saved-searches-e2e.mjs [--base-url http://localhost:3000]
 *
 * Signs a throwaway user in via Supabase, then drives the REAL API routes with
 * that session's cookies — the same path the browser takes. Proves identity is
 * enforced server-side (never from the request body), duplicates collapse,
 * edits persist, deletes work, and one user cannot touch another's rows.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i !== -1 && !(t.slice(0, i).trim() in process.env)) {
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const BASE = arg("--base-url", "http://localhost:3000").replace(/\/$/, "");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Sign in and return the cookie header the app's middleware expects. */
async function sessionCookies(creds) {
  const c = createClient(SUPA_URL, SUPA_KEY);
  await c.auth.signUp(creds);
  const { data, error } = await c.auth.signInWithPassword(creds);
  if (error) throw new Error(error.message);
  const ref = new URL(SUPA_URL).hostname.split(".")[0];
  // @supabase/ssr stores the session as a base64url-encoded JSON cookie.
  const payload = Buffer.from(JSON.stringify(data.session)).toString("base64url");
  return { cookie: `sb-${ref}-auth-token=base64-${payload}`, user: data.user, client: c };
}

const api = (path, cookie, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });

const SEARCH_QS = "q=chanel+runners&sizes=footwear%3A13&trust=guarantee&markets=ebay,grailed";

async function main() {
  console.log(`saved-searches e2e against ${BASE}\n`);
  const stamp = Date.now();

  console.log("━━ unauthenticated access");
  const anonList = await fetch(`${BASE}/api/saved-searches`);
  check("GET without a session is 401", anonList.status === 401, `got ${anonList.status}`);
  const anonPost = await fetch(`${BASE}/api/saved-searches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ searchQueryString: SEARCH_QS, name: "hack" }),
  });
  check("POST without a session is 401", anonPost.status === 401, `got ${anonPost.status}`);

  console.log("\n━━ sign in");
  let A, B;
  try {
    A = await sessionCookies({ email: `sa-${stamp}@example.com`, password: `Aa1!${stamp}aa` });
    B = await sessionCookies({ email: `sb-${stamp}@example.com`, password: `Bb1!${stamp}bb` });
    check("two users signed in", Boolean(A.user && B.user));
  } catch (e) {
    check("sign in", false, e.message);
    return finish();
  }

  console.log("\n━━ save (create)");
  const created = await api("/api/saved-searches", A.cookie, {
    method: "POST",
    body: JSON.stringify({
      searchQueryString: SEARCH_QS,
      name: "Chanel Runners · US 13",
      notificationsEnabled: true,
      notificationTypes: ["new_listings"],
    }),
  });
  check("create returns 201", created.status === 201, `got ${created.status}`);
  const { savedSearch: rec } = await created.json();
  check("stored the normalized filters", rec?.filters?.sizeFilters?.[0]?.type === "footwear",
    JSON.stringify(rec?.filters?.sizeFilters?.[0]));
  check("stored trust filter", rec?.filters?.trust?.includes("guarantee"));
  check("notification prefs stored", rec?.notificationsEnabled === true &&
    rec?.notificationTypes?.includes("new_listings"));
  check("no pagination stored", !("page" in (rec ?? {})) && !("perPage" in (rec ?? {})));

  console.log("\n━━ ownership is server-derived");
  const spoof = await api("/api/saved-searches", A.cookie, {
    method: "POST",
    body: JSON.stringify({
      searchQueryString: "q=spoof-attempt",
      name: "spoofed",
      userId: B.user.id, // ignored: identity comes from the session
    }),
  });
  const spoofBody = await spoof.json();
  const bList = await api("/api/saved-searches", B.cookie).then((r) => r.json());
  check(
    "a userId in the body is ignored",
    !(bList.savedSearches ?? []).some((s) => s.id === spoofBody.savedSearch?.id),
    `B has ${(bList.savedSearches ?? []).length} searches`,
  );

  console.log("\n━━ duplicate save");
  const dup = await api("/api/saved-searches", A.cookie, {
    method: "POST",
    body: JSON.stringify({ searchQueryString: SEARCH_QS, name: "different name" }),
  });
  const dupBody = await dup.json();
  check("duplicate returns 200 (not created)", dup.status === 200, `got ${dup.status}`);
  check("duplicate flagged", dupBody.duplicate === true);
  check("duplicate returns the SAME record", dupBody.savedSearch?.id === rec.id);

  console.log("\n━━ a different refinement is a DIFFERENT search");
  const other = await api("/api/saved-searches", A.cookie, {
    method: "POST",
    body: JSON.stringify({ searchQueryString: "q=chanel+runners&sizes=footwear%3A13", name: "no trust" }),
  });
  const otherBody = await other.json();
  check("saved as a new search", other.status === 201 && otherBody.savedSearch.id !== rec.id,
    `status ${other.status}`);

  console.log("\n━━ edit");
  const renamed = await api(`/api/saved-searches/${rec.id}`, A.cookie, {
    method: "PATCH",
    body: JSON.stringify({ name: "Renamed hunt", notificationTypes: ["price_drops"] }),
  });
  const renamedBody = await renamed.json();
  check("rename persisted", renamedBody.savedSearch?.name === "Renamed hunt");
  check("alert prefs updated", renamedBody.savedSearch?.notificationTypes?.includes("price_drops"));

  console.log("\n━━ cross-user isolation via the API");
  const bEdit = await api(`/api/saved-searches/${rec.id}`, B.cookie, {
    method: "PATCH",
    body: JSON.stringify({ name: "hijacked" }),
  });
  check("B cannot edit A's search", bEdit.status === 404, `got ${bEdit.status}`);
  const bDel = await api(`/api/saved-searches/${rec.id}`, B.cookie, { method: "DELETE" });
  check("B cannot delete A's search", bDel.status === 404, `got ${bDel.status}`);
  const stillA = await api("/api/saved-searches", A.cookie).then((r) => r.json());
  check("A's search survived unchanged",
    stillA.savedSearches?.find((s) => s.id === rec.id)?.name === "Renamed hunt");

  console.log("\n━━ delete");
  const del = await api(`/api/saved-searches/${rec.id}`, A.cookie, { method: "DELETE" });
  check("delete returns 204", del.status === 204, `got ${del.status}`);
  const after = await api("/api/saved-searches", A.cookie).then((r) => r.json());
  check("row is gone", !after.savedSearches?.some((s) => s.id === rec.id));

  // cleanup remaining rows
  for (const s of after.savedSearches ?? []) {
    await api(`/api/saved-searches/${s.id}`, A.cookie, { method: "DELETE" });
  }
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
