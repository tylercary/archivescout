import {
  computeChallengeResponse,
  handleAccountDeletion,
  resolveDeletionConfig,
  safeMetadata,
} from "@/lib/ebay/account-deletion";

/**
 * eBay Marketplace Account Deletion endpoint.
 *
 *   GET  ?challenge_code=…  → { "challengeResponse": "<sha256 hex>" }
 *   POST  (JSON body)       → 204 No Content
 *
 * PUBLIC AND UNAUTHENTICATED BY DESIGN — eBay calls it with no credentials, so
 * it must never sit behind auth. It exposes nothing: the GET answers a hash
 * challenge and the POST acknowledges a notification. Secrets are read from
 * the server environment only and are never echoed back.
 *
 * See lib/ebay/account-deletion.ts for the hash contract and the note on why
 * there is currently no user data to erase.
 */

// Node runtime for node:crypto; force-dynamic so the challenge is never cached
// or statically pre-rendered (eBay sends a fresh challenge_code each time).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** JSON with no BOM, no caching, no redirects. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const challengeCode = new URL(request.url).searchParams.get("challenge_code");

  if (!challengeCode) {
    return json({ error: "Missing required query parameter: challenge_code" }, 400);
  }

  const config = resolveDeletionConfig();
  if (!config.ok) {
    // Names of missing/invalid vars go to the SERVER LOG only. The response
    // stays generic so a caller can never probe the configuration.
    console.error(
      `[ebay-account-deletion] endpoint misconfigured: ${config.problems.join("; ")}`,
    );
    return json({ error: "Endpoint is not configured" }, 500);
  }

  const challengeResponse = computeChallengeResponse(
    challengeCode,
    config.verificationToken,
    config.endpoint,
  );

  return json({ challengeResponse }, 200);
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "Expected content-type: application/json" }, 415);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  await handleAccountDeletion(payload);

  // Development-only, and only the envelope — `notification.data` (username,
  // userId, eiasToken) is never read, so member identifiers cannot leak into
  // logs in any environment.
  if (process.env.NODE_ENV !== "production") {
    const meta = safeMetadata(payload);
    // eslint-disable-next-line no-console
    console.log(
      `[ebay-account-deletion] received topic=${meta.topic ?? "?"} ` +
        `id=${meta.notificationId ?? "?"} published=${meta.publishDate ?? "?"} ` +
        `attempt=${meta.publishAttemptCount ?? "?"}`,
    );
  }

  // eBay accepts 200 or 204; acknowledge immediately with no body.
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
