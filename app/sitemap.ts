import type { MetadataRoute } from "next";
import { TRENDING_SEARCHES } from "@/lib/constants";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://archivescout.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}/search`, changeFrequency: "hourly", priority: 0.9 },
  ];

  // Surface trending queries as indexable, search-friendly URLs.
  const trendingRoutes: MetadataRoute.Sitemap = TRENDING_SEARCHES.map((t) => ({
    url: `${siteUrl}/search?q=${encodeURIComponent(t.query)}`,
    changeFrequency: "daily",
    priority: 0.6,
  }));

  return [...staticRoutes, ...trendingRoutes];
}
