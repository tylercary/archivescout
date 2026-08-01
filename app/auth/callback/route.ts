import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * OAuth callback (PKCE code exchange).
 *
 * Google → Supabase (`/auth/v1/callback`) → HERE. Supabase hands us a
 * short-lived `code`; exchanging it server-side sets the session cookies on
 * the response. No Google token ever reaches the browser, and nothing is
 * written to local storage.
 *
 * The `next` destination is attacker-controllable (it rides in a linkable
 * URL), so it is validated as a same-origin path before we redirect —
 * otherwise this route would be an open redirect for freshly-authenticated
 * users.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send the user back to sign-in with a readable, non-leaky reason. */
function toSignIn(origin: string, reason: string, next: string) {
  const url = new URL("/signin", origin);
  url.searchParams.set("error", reason);
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { origin, searchParams } = url;

  // Where to land afterwards — validated, never trusted as given.
  const next = safeNext(searchParams.get("next"));

  // The user dismissed Google's consent screen, or the provider refused.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    const description = searchParams.get("error_description") ?? "";
    const reason = /access_denied/i.test(oauthError)
      ? "cancelled"
      : /disabled|unsupported/i.test(oauthError + description)
        ? "provider_disabled"
        : "oauth_failed";
    return toSignIn(origin, reason, next);
  }

  const code = searchParams.get("code");
  if (!code) return toSignIn(origin, "missing_code", next);

  const supabase = getSupabaseServerClient();
  if (!supabase) return toSignIn(origin, "not_configured", next);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Expired/replayed code, PKCE mismatch, or a redirect-URL mismatch that
    // Supabase rejected. The specific message may contain configuration
    // detail, so it is logged rather than shown.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.error("[auth/callback] exchange failed:", error.message);
    }
    return toSignIn(origin, "exchange_failed", next);
  }

  // Session cookies are attached by the server client's cookie adapter.
  return NextResponse.redirect(new URL(next, origin));
}
