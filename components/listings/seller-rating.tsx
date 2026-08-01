import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact seller rating: a single star + numeric value. */
export function SellerRating({
  rating,
  className,
}: {
  rating?: number;
  className?: string;
}) {
  if (rating === undefined) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
      aria-label={`Seller rating ${rating.toFixed(1)} out of 5`}
    >
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span className="font-medium text-foreground">{rating.toFixed(1)}</span>
    </span>
  );
}
