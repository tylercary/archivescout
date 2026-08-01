"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Info, Loader2, Lock, Mail } from "lucide-react";
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
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Resume whatever the user was doing before the auth gate. Only
        // same-origin relative paths are honored — an absolute URL here would
        // be an open-redirect.
        const next = searchParams.get("next");
        const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/saved";
        router.push(safeNext);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage({
          type: "ok",
          text: "Check your email to confirm your account, then sign in.",
        });
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

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
