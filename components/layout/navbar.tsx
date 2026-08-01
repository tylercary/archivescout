"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Heart, Menu, Scale, Search, User, X } from "lucide-react";
import { Logo } from "./logo";
import { NavbarSearch, NavbarSearchFallback } from "./navbar-search";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useFavorites } from "@/lib/store/favorites";
import { useCompare } from "@/lib/store/compare";
import { useAuth } from "@/lib/supabase/auth-context";
import { cn } from "@/lib/utils";

// "Search" is no longer a link — the search component itself lives in the bar.
const NAV_LINKS = [
  { href: "/saved", label: "Saved items", icon: Heart },
  { href: "/searches", label: "Saved searches", icon: Bookmark },
];

export function Navbar() {
  const pathname = usePathname();
  const { favorites, hydrated: favHydrated } = useFavorites();
  const { items, setDrawerOpen, hydrated: cmpHydrated } = useCompare();
  const { user, loading: authLoading, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = React.useState(false);

  const favCount = favHydrated ? favorites.length : 0;
  const cmpCount = cmpHydrated ? items.length : 0;

  // The homepage hero already renders the search component; showing it in the
  // navbar too would put two identical search bars on one screen.
  const showSearch = pathname !== "/";

  // Collapse the mobile search row on navigation. A search that only changes
  // the query string keeps the same pathname, so the row also closes from
  // SearchBar's onSubmit below — this covers leaving /search entirely.
  React.useEffect(() => setMobileSearchOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center gap-3 lg:gap-5">
        <Logo />

        {/* Primary search. Tablet gets a narrower box before the nav collapses;
            below md it becomes a search icon that opens the row underneath. */}
        {showSearch ? (
          <div className="hidden min-w-0 flex-1 md:block lg:max-w-xl">
            <React.Suspense fallback={<NavbarSearchFallback />}>
              <NavbarSearch />
            </React.Suspense>
          </div>
        ) : (
          <div className="hidden flex-1 md:block" />
        )}

        <nav
          className="hidden items-center gap-1 lg:flex"
          aria-label="Primary"
        >
          {NAV_LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:px-3",
                  active && "text-foreground",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {link.label}
                  {link.href === "/saved" && favCount > 0 && (
                    <CountPill>{favCount}</CountPill>
                  )}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
          {/* Mobile: never squeeze the desktop bar in — a toggle opens the same
              component full-width on the row below. */}
          {showSearch && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={mobileSearchOpen ? "Close search" : "Open search"}
              aria-expanded={mobileSearchOpen}
              onClick={() => setMobileSearchOpen((o) => !o)}
            >
              {mobileSearchOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Open comparison (${cmpCount} selected)`}
          >
            <Scale className="h-4 w-4" />
            Compare
            {cmpCount > 0 && <CountPill>{cmpCount}</CountPill>}
          </Button>

          {authLoading ? (
            <div
              aria-hidden
              className="hidden h-8 w-20 rounded-md bg-secondary lg:block"
            />
          ) : user ? (
            <div className="hidden items-center gap-1.5 lg:flex">
              <span
                className="max-w-[12rem] truncate text-sm text-muted-foreground"
                title={user.email ?? undefined}
              >
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="hidden lg:inline-flex">
              <Link href="/signin">
                <User className="h-4 w-4" />
                Sign in
              </Link>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Mobile search row — the SAME component, rendered full-width. Only
          mounted while open, so there's never a second search bar in the DOM. */}
      {showSearch && mobileSearchOpen && (
        <div className="border-t border-border px-4 pb-3 pt-2 md:hidden">
          <React.Suspense fallback={<NavbarSearchFallback />}>
            <NavbarSearch autoFocus onSubmit={() => setMobileSearchOpen(false)} />
          </React.Suspense>
        </div>
      )}

      <Sheet
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        side="right"
        label="Menu"
      >
        <div className="flex h-full flex-col p-6 pt-16">
          <Logo />
          <nav className="mt-8 flex flex-col gap-1" aria-label="Mobile">
            {NAV_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-3 text-base font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  {link.label}
                  {link.href === "/saved" && favCount > 0 && (
                    <CountPill className="ml-auto">{favCount}</CountPill>
                  )}
                </Link>
              );
            })}
            <button
              onClick={() => {
                setMobileOpen(false);
                setDrawerOpen(true);
              }}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-left text-base font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Scale className="h-5 w-5 text-muted-foreground" />
              Compare
              {cmpCount > 0 && <CountPill className="ml-auto">{cmpCount}</CountPill>}
            </button>
          </nav>
          <div className="mt-auto">
            {user ? (
              <div className="space-y-2">
                <p className="truncate px-3 text-sm text-muted-foreground">
                  {user.email}
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    setMobileOpen(false);
                    signOut();
                  }}
                >
                  Sign out
                </Button>
              </div>
            ) : (
              <Button asChild className="w-full" size="lg">
                <Link href="/signin" onClick={() => setMobileOpen(false)}>
                  <User className="h-4 w-4" />
                  Sign in
                </Link>
              </Button>
            )}
          </div>
        </div>
      </Sheet>
    </header>
  );
}

function CountPill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.68rem] font-semibold text-primary-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
