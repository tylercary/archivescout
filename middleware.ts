import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Refreshes the Supabase auth session on every request.
 *
 * Access tokens are short-lived; without this, a signed-in user silently drops
 * to signed-out as soon as their token expires. `getUser()` performs the
 * refresh and the rotated cookies are written onto the outgoing response.
 *
 * Runs ONLY when Supabase is configured — ArchiveScout is designed to work
 * fully anonymously, so an unconfigured deployment passes straight through.
 */
export async function middleware(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        // Write to BOTH the request (so downstream server components see the
        // fresh session) and the response (so the browser stores it).
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not remove: this call is what performs the refresh.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Everything except static assets and image optimization.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
