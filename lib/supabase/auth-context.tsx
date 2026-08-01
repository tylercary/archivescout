"use client";

import * as React from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";
import { isSupabaseConfigured } from "./config";

/**
 * The app's single source of truth for "who is signed in".
 *
 * ArchiveScout works fully anonymously — search, filters, favourites and
 * compare never require an account. This context exists so PERSONALIZED
 * features (saved searches, and later collections/alerts) can key off a real
 * user id instead of a device-local guess.
 *
 * When Supabase isn't configured, `configured` is false and `user` is null;
 * every consumer must handle that rather than assuming an account exists.
 */

export interface AuthState {
  /** The signed-in user, or null when anonymous / unconfigured. */
  user: User | null;
  /** False until the initial session lookup settles (avoids UI flicker). */
  loading: boolean;
  /** Whether auth is even available in this deployment. */
  configured: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(isSupabaseConfigured);

  React.useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    // getUser() validates against the auth server rather than trusting a
    // possibly-stale cookie, so the initial state is authoritative.
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setLoading(false);
    });

    // Keeps every tab in sync: sign-in, sign-out, and token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = React.useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const value = React.useMemo<AuthState>(
    () => ({ user, loading, configured: isSupabaseConfigured, signOut }),
    [user, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
