#!/usr/bin/env node
/**
 * Verifies the eBay Marketplace Account Deletion endpoint.
 *
 *   node scripts/test-ebay-account-deletion.mjs [--base-url http://localhost:3000]
 *
 * Checks:
 *   1. GET  ?challenge_code=…   → 200 + challengeResponse matches a locally
 *                                 computed SHA256(code + token + endpoint)
 *   2. GET  (no challenge_code) → 400
 *   3. POST (JSON body)         → 200/204
 *   4. POST (non-JSON)          → 4xx
 *   5. Misconfigured server     → 500, leaking no secret
 *      (only when MISCONFIGURED_BASE_URL points at a server started WITHOUT
 *       EBAY_DELETION_VERIFICATION_TOKEN / EBAY_DELETION_ENDPOINT)
 *
 * Reads the token/endpoint from the environment, falling back to .env.local so
 * it works without extra setup. Secrets are never printed — only lengths.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PATHNAME = "/api/ebay/account-deletion";

/** Minimal .env parser — only used to fill gaps in process.env. */
function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    /* no .env.local — rely on the real environment */
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  loadEnvLocal();

  const baseUrl = arg("--base-url", "http://localhost:3000").replace(/\/$/, "");
  const token = process.env.EBAY_DELETION_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_DELETION_ENDPOINT;

  if (!token || !endpoint) {
    console.error(
      "Missing EBAY_DELETION_VERIFICATION_TOKEN and/or EBAY_DELETION_ENDPOINT " +
        "(set them in .env.local or the environment).",
    );
    process.exit(1);
  }

  console.log(`eBay account-deletion endpoint test`);
  console.log(`  server   : ${baseUrl}${PATHNAME}`);
  console.log(`  token    : ${token.length} chars (value hidden)`);
  console.log(`  endpoint : ${endpoint}`);
  console.log("");

  // ── 1. GET challenge ────────────────────────────────────────────────────
  const challengeCode = "archivescout-test-" + "a1b2c3d4e5f6";
  const expected = createHash("sha256")
    .update(challengeCode)
    .update(token)
    .update(endpoint)
    .digest("hex");

  try {
    const res = await fetch(
      `${baseUrl}${PATHNAME}?challenge_code=${encodeURIComponent(challengeCode)}`,
      { redirect: "manual" },
    );
    const raw = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* handled below */
    }

    check("GET returns 200", res.status === 200, `got ${res.status}`);
    check("Content-Type is application/json", ct.includes("application/json"), ct);
    check("no redirect", res.status < 300 || res.status >= 400, `status ${res.status}`);
    check("body has no BOM", !raw.startsWith("﻿"));
    check("body is not HTML", !raw.trimStart().startsWith("<"));
    check(
      "challengeResponse matches SHA256(code + token + endpoint)",
      body?.challengeResponse === expected,
      body?.challengeResponse
        ? `got ${String(body.challengeResponse).slice(0, 16)}…, expected ${expected.slice(0, 16)}…`
        : "no challengeResponse in body",
    );
    check(
      "challengeResponse is lowercase hex (64 chars)",
      typeof body?.challengeResponse === "string" &&
        /^[0-9a-f]{64}$/.test(body.challengeResponse),
    );
  } catch (err) {
    check("GET challenge request", false, String(err));
  }

  // ── 2. GET without challenge_code ───────────────────────────────────────
  try {
    const res = await fetch(`${baseUrl}${PATHNAME}`, { redirect: "manual" });
    const raw = await res.text();
    check("GET without challenge_code returns 400", res.status === 400, `got ${res.status}`);
    check("400 body does not contain the token", !raw.includes(token));
  } catch (err) {
    check("GET without challenge_code", false, String(err));
  }

  // ── 3. POST notification ────────────────────────────────────────────────
  const notification = {
    metadata: {
      topic: "MARKETPLACE_ACCOUNT_DELETION",
      schemaVersion: "1.0",
      deprecated: false,
    },
    notification: {
      notificationId: "test-notification-id",
      eventDate: "2026-07-30T00:00:00.000Z",
      publishDate: "2026-07-30T00:00:00.000Z",
      publishAttemptCount: 1,
      data: {
        username: "test-user",
        userId: "test-user-id",
        eiasToken: "test-eias-token",
      },
    },
  };

  try {
    const res = await fetch(`${baseUrl}${PATHNAME}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(notification),
      redirect: "manual",
    });
    check(
      "POST JSON returns 200 or 204",
      res.status === 200 || res.status === 204,
      `got ${res.status}`,
    );
  } catch (err) {
    check("POST notification", false, String(err));
  }

  // ── 4. POST non-JSON ────────────────────────────────────────────────────
  try {
    const res = await fetch(`${baseUrl}${PATHNAME}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
      redirect: "manual",
    });
    check("POST non-JSON is rejected (4xx)", res.status >= 400 && res.status < 500, `got ${res.status}`);
  } catch (err) {
    check("POST non-JSON", false, String(err));
  }

  // ── 5. Misconfigured server (optional) ──────────────────────────────────
  const misconfigured = process.env.MISCONFIGURED_BASE_URL;
  if (misconfigured) {
    try {
      const res = await fetch(
        `${misconfigured.replace(/\/$/, "")}${PATHNAME}?challenge_code=abc`,
        { redirect: "manual" },
      );
      const raw = await res.text();
      check("missing env vars returns 500", res.status === 500, `got ${res.status}`);
      check("500 body leaks no secret", !raw.includes(token) && !raw.includes(endpoint), raw.slice(0, 80));
    } catch (err) {
      check("misconfigured server", false, String(err));
    }
  } else {
    console.log("  · skipped misconfigured-server check (set MISCONFIGURED_BASE_URL)");
  }

  const failed = results.filter((r) => !r.passed);
  console.log("");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
