import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There's a package-lock.json in the home folder; without this Next.js picks it as the workspace root.
  outputFileTracingRoot: __dirname,
  // Local club subdomains (raccoon.courtix.localhost:3000) load the dev server's scripts.
  allowedDevOrigins: ["courtix.localhost", "*.courtix.localhost"],
  async headers() {
    return [
      {
        // Don't tell outside sites (wa.me, LINE) which page staff came from. LINE's web
        // share page otherwise attaches the app's address to the message.
        // "same-origin", not "no-referrer": with no-referrer, Chrome sends `Origin: null` on
        // plain form posts (before JavaScript has loaded, or with it off), and Next.js server
        // actions then fail with "Invalid URL". Our own pages still get the real origin.
        source: "/:path*",
        headers: [{ key: "Referrer-Policy", value: "same-origin" }],
      },
    ];
  },
};

export default nextConfig;
