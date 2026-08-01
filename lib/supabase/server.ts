import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "./types";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

type ServerClient = ReturnType<typeof createServerClient<Database>>;

/**
 * Returns a server Supabase client bound to the request cookies, or `null`
 * when Supabase isn't configured. Use in Server Components / Route Handlers.
 */
export function getSupabaseServerClient(): ServerClient | null {
  if (!isSupabaseConfigured) return null;

  const cookieStore = cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore when middleware
          // refreshes sessions instead.
        }
      },
    },
  });
}
