"use client";

import * as React from "react";
import { AuthProvider } from "@/lib/supabase/auth-context";
import { CompareProvider } from "./compare";
import { FavoritesProvider } from "./favorites";
import { SearchesProvider } from "./searches";

/** Composes all client-side stores. Mounted once in the root layout. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <FavoritesProvider>
        <CompareProvider>
          <SearchesProvider>{children}</SearchesProvider>
        </CompareProvider>
      </FavoritesProvider>
    </AuthProvider>
  );
}
