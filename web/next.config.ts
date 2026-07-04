import type { NextConfig } from "next";

// Server-side proxy target for the Go API. In docker-compose this points at
// the api container; in local dev it's the natively-running API.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      // AniList cover/banner CDN
      { protocol: "https", hostname: "s4.anilist.co" },
    ],
  },
  async rewrites() {
    // The browser only ever talks to this origin; /api/* is transparently
    // proxied to the Go API so auth cookies stay same-site and CORS never
    // enters the picture.
    return [
      { source: "/api/:path*", destination: `${API_INTERNAL_URL}/api/:path*` },
    ];
  },
};

export default nextConfig;
