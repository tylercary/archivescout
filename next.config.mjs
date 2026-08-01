/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Mock imagery.
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
      // Real marketplace CDN hosts (live mode). Wildcards cover their subdomains
      // (e.g. media-assets.grailed.com, i.ebayimg.com).
      { protocol: "https", hostname: "**.ebayimg.com" },
      { protocol: "https", hostname: "**.grailed.com" },
    ],
  },
};

export default nextConfig;
