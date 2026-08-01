import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchResults } from "@/components/search/search-results";
import { SkeletonGrid } from "@/components/search/search-states";

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export function generateMetadata({ searchParams }: PageProps): Metadata {
  const q =
    typeof searchParams.q === "string" ? searchParams.q.trim() : undefined;

  const title = q ? `${q} — resale listings` : "Search resale listings";
  const description = q
    ? `Compare ${q} listings from eBay and Grailed in one place. Filter by price, size, condition, and more.`
    : "Search fashion listings across eBay and Grailed. Filter, compare, and save the pieces you want.";

  return {
    title,
    description,
    alternates: { canonical: q ? `/search?q=${encodeURIComponent(q)}` : "/search" },
    openGraph: { title: `${title} · ArchiveScout`, description },
  };
}

export default function SearchPage() {
  // The search bar lives in the navbar (see components/layout/navbar.tsx), so
  // this page renders results only — no search row of its own.
  return (
    <Suspense fallback={<SearchPageFallback />}>
      <SearchResults />
    </Suspense>
  );
}

function SearchPageFallback() {
  return (
    <div className="container py-8">
      <div className="mb-6 h-9 w-56 rounded-md shimmer" />
      <SkeletonGrid count={8} />
    </div>
  );
}
