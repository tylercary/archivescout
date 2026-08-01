/** Public Supabase config, read from env. Empty strings when not configured. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Whether Supabase is wired up. The entire app is designed to run WITHOUT
 * Supabase (favorites/searches fall back to local storage), so every consumer
 * must check this before creating a client.
 */
export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
