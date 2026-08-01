"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Info, Loader2, Lock, Mail } from "lucide-react";
import { safeNext as validateNext } from "@/lib/auth/safe-next";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "error" | "ok"; text: string } | null>(null);

  const configured = isSupabaseConfigured;
  const [oauthPending, setOauthPending] = React.useState(false);

  // The post-auth destination, validated once. Email/password and Google both
  // use it, so the two paths land in exactly the same place.
  const nextPath = validateNext(searchParams.get("next"), "/saved");

  // Readable messages for whatever /auth/callback bounced back with. The
  // underlying provider/config detail stays server-side.
  const CALLBACK_ERRORS: Record<string, string> = {
    cancelled: "Google sign-in was cancelled.",
    provider_disabled:
      "Google sign-in isn't enabled for this project yet. Use email and password, or enable Google in Supabase.",
    missing_code: "Google didn't return a sign-in code. Please try again.",
    exchange_failed:
      "That sign-in link expired or was already used. Please try again.",
    not_configured: "Authentication isn't configured in this deployment.",
    oauth_failed: "Google sign-in didn't complete. Please try again.",
  };
  const callbackError = searchParams.get("error");

  React.useEffect(() => {
    if (callbackError) {
      setMessage({
        type: "error",
        text: CALLBACK_ERRORS[callbackError] ?? "Sign-in didn't complete. Please try again.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callbackError]);

  const signInWithGoogle = async () => {
    if (oauthPending) return; // guard double-clicks: one redirect only
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMessage({ type: "error", text: "Authentication isn't configured in this deployment." });
      return;
    }
    setOauthPending(true);
    try {
      // Carry `next` (and the ?save=1 resume flag it may contain) through
      // Google → Supabase → /auth/callback, which re-validates it.
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
      // Success = a full-page redirect to Google; keep the spinner until then.
    } catch (err) {
      setOauthPending(false);
      const msg = err instanceof Error ? err.message : "";
      setMessage({
        type: "error",
        text: /provider|disabled|not enabled/i.test(msg)
          ? "Google sign-in isn't enabled for this project yet. Use email and password, or enable Google in Supabase."
          : "Couldn't start Google sign-in. Check your connection and try again.",
      });
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setMessage({
        type: "error",
        text: "Authentication isn't configured in this demo. Your saved items and searches are stored on this device.",
      });
      return;
    }
    setPending(true);
    // Resume whatever the user was doing before the auth gate. Only same-origin
    // relative paths are honored — an absolute URL here would be an open-redirect.
    const safeNext = nextPath;

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(safeNext);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // When email confirmation is DISABLED, sign-up returns a live session —
        // the user is already signed in, so continue straight to what they were
        // doing instead of telling them to check a mailbox that gets nothing.
        if (data.session) {
          router.push(safeNext);
          router.refresh();
        } else {
          setMessage({
            type: "ok",
            text: "Check your email to confirm your account, then sign in.",
          });
        }
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to sync your saved items, searches, and price alerts."
            : "Save items across devices and get price alerts on your hunts."}
        </p>
      </div>

      {!configured && (
        <div className="mt-6 flex items-start gap-2.5 rounded-md border border-border bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Demo mode: authentication isn&apos;t configured, but favorites,
            comparisons, and saved searches all work locally on this device.
          </span>
        </div>
      )}

      {/* Mode toggle */}
      <div className="mt-8 flex rounded-full border border-border bg-secondary p-1 text-sm">
        {(["signin", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setMessage(null);
            }}
            className={cn(
              "flex-1 rounded-full px-4 py-2 font-medium transition-colors",
              mode === m
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {/* Google first: fastest path for most users. Email/password stays
          fully supported below the divider. */}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="mt-6 w-full"
        onClick={signInWithGoogle}
        disabled={!configured || oauthPending || pending}
        aria-busy={oauthPending}
      >
        {oauthPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Redirecting to Google…
          </>
        ) : (
          <>
            <GoogleMark />
            Continue with Google
          </>
        )}
      </Button>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or continue with email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="pl-9"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pl-9"
            />
          </div>
        </div>

        {message && (
          <p
            role="status"
            className={cn(
              "rounded-md px-3 py-2 text-sm",
              message.type === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
            )}
          >
            {message.text}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/search" className="underline-offset-2 hover:text-foreground hover:underline">
          Continue without an account
        </Link>
      </p>
    </div>
  );
}

/** Google's official "G" mark. Inline SVG — no external request, no tracking. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
