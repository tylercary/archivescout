import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://archivescout.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/search"],
      // Keep private account pages out of search indexes.
      disallow: ["/saved", "/searches", "/compare", "/signin", "/api/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
