"use client";

import { Heart } from "lucide-react";
import type { Listing } from "@/lib/marketplaces/types";
import { useFavorites } from "@/lib/store/favorites";
import { cn } from "@/lib/utils";

export function FavoriteButton({
  listing,
  className,
  size = "md",
}: {
  listing: Listing;
  className?: string;
  size?: "sm" | "md";
}) {
  const { isFavorite, toggle, hydrated } = useFavorites();
  const active = hydrated && isFavorite(listing.id);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(listing);
      }}
      aria-pressed={active}
      aria-label={active ? "Remove from saved items" : "Save item"}
      title={active ? "Saved" : "Save item"}
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur transition-all hover:scale-105 hover:bg-card active:scale-95",
        size === "md" ? "h-9 w-9" : "h-8 w-8",
        className,
      )}
    >
      <Heart
        className={cn(
          size === "md" ? "h-[18px] w-[18px]" : "h-4 w-4",
          "transition-colors",
          active ? "fill-red-500 text-red-500" : "text-foreground",
        )}
      />
    </button>
  );
}
