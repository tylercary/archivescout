import { NextResponse } from "next/server";
import { runAlertSweep } from "@/lib/saved-searches/alert-sweep";
import { alertsReadiness } from "@/lib/saved-searches/alerts-config";

/**
 * Saved-search alert sweep endpoint.
 *
 *   POST /api/cron/saved-search-alerts
 *   Authorization: Bearer <ALERT_CRON_SECRET>
 *
 * Protected by a shared secret because it is a public URL that performs real
 * work (marketplace API calls and email sends). Vercel Cron sends the secret
 * as a Bearer token; any other caller gets 401 with no detail about why.
 *
 * Safe to retry: the sweep leases each saved search and every alert carries a
 * unique dedupe key, so a duplicate invocation records nothing twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Sweeps hit live marketplace APIs; give them room but stay bounded. */
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Constant-time-ish comparison: avoids leaking secret length via timing. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function authorize(request: Request): boolean {
  const expected = process.env.ALERT_CRON_SECRET;
  if (!expected) return false; // no secret configured ⇒ nothing is authorized

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer && secretMatches(bearer, expected)) return true;

  // Vercel Cron also supports a plain header; accept it for convenience.
  const alt = request.headers.get("x-cron-secret") ?? "";
  return Boolean(alt) && secretMatches(alt, expected);
}

export async function POST(request: Request) {
  if (!authorize(request)) return unauthorized();

  const readiness = alertsReadiness();
  if (!readiness.enabled) {
    // 503, not 500: the request was fine, the service just isn't switched on.
    // Names of missing vars are safe (they are not values).
    return NextResponse.json(
      { ok: false, reason: "alerts_disabled", missing: readiness.missing },
      { status: 503 },
    );
  }

  try {
    const summary = await runAlertSweep();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[alert-sweep] fatal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Sweep failed" }, { status: 500 });
  }
}

/** GET is a readiness probe only — it never runs a sweep. */
export async function GET(request: Request) {
  if (!authorize(request)) return unauthorized();
  const readiness = alertsReadiness();
  return NextResponse.json({
    ok: true,
    enabled: readiness.enabled,
    missing: readiness.missing,
  });
}
