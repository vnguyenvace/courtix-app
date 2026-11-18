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
        source: "/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
