"use client";

import * as React from "react";
import { Check, Scale } from "lucide-react";
import type { Listing } from "@/lib/marketplaces/types";
import { useCompare, MAX_COMPARE } from "@/lib/store/compare";
import { cn } from "@/lib/utils";

/** Toggles a listing into the comparison set; shows a hint when full. */
export function CompareToggle({
  listing,
  className,
  variant = "icon",
}: {
  listing: Listing;
  className?: string;
  variant?: "icon" | "full";
}) {
  const { isComparing, toggle, hydrated } = useCompare();
  const active = hydrated && isComparing(listing.id);
  const [rejected, setRejected] = React.useState(false);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const accepted = toggle(listing);
    if (!accepted) {
      setRejected(true);
      window.setTimeout(() => setRejected(false), 1800);
    }
  };

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-card hover:bg-accent",
          className,
        )}
      >
        {active ? <Check className="h-4 w-4" /> : <Scale className="h-4 w-4" />}
        {active ? "Comparing" : rejected ? `Max ${MAX_COMPARE} reached` : "Compare"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "Remove from comparison" : "Add to comparison"}
      title={
        rejected
          ? `You can compare up to ${MAX_COMPARE} items`
          : active
            ? "Comparing"
            : "Compare"
      }
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-all hover:scale-105 active:scale-95",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card/90 text-foreground hover:bg-card",
        rejected && "border-destructive text-destructive",
        className,
      )}
    >
      {active ? <Check className="h-[18px] w-[18px]" /> : <Scale className="h-[18px] w-[18px]" />}
    </button>
  );
}
