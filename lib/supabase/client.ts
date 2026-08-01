"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./config";

type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let cached: BrowserClient | null = null;

/**
 * Returns a browser Supabase client, or `null` when Supabase isn't configured.
 * Callers MUST handle the null case (the app works without auth).
 */
export function getSupabaseBrowserClient(): BrowserClient | null {
  if (!isSupabaseConfigured) return null;
  if (cached) return cached;
  cached = createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
