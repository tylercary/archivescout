"use client";

import Link from "next/link";
import { Heart, Search, Trash2 } from "lucide-react";
import { useFavorites } from "@/lib/store/favorites";
import { enrichListing } from "@/lib/listings";
import { ListingGrid } from "@/components/listings/listing-grid";
import { Button } from "@/components/ui/button";
import { SkeletonGrid } from "@/components/search/search-states";

export function SavedItems() {
  const { favorites, clear, hydrated } = useFavorites();

  if (!hydrated) {
    return (
      <div className="container py-8">
        <SkeletonGrid count={4} />
      </div>
    );
  }

  const listings = favorites.map((f) => enrichListing(f.listing));

  return (
    <div className="container py-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your collection</p>
          <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Saved items
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {favorites.length}{" "}
            {favorites.length === 1 ? "item" : "items"} saved to your collection.
          </p>
        </div>
        {favorites.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <Trash2 className="h-4 w-4" />
            Clear all
          </Button>
        )}
      </header>

      {listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-sm">
            <Heart className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
            No saved items yet
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Tap the heart on any listing to save it here. Your collection is
            stored on this device.
          </p>
          <Button asChild className="mt-6">
            <Link href="/search">
              <Search className="h-4 w-4" />
              Start searching
            </Link>
          </Button>
        </div>
      ) : (
        <ListingGrid listings={listings} priorityCount={4} />
      )}
    </div>
  );
}
