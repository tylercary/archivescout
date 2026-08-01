import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { TRENDING_SEARCHES } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function TrendingSearches({
  className,
  label = "Trending",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-2", className)}>
      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5" />
        {label}
      </span>
      {TRENDING_SEARCHES.map((t) => (
        <Link
          key={t.query}
          href={`/search?q=${encodeURIComponent(t.query)}`}
          className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-md"
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
