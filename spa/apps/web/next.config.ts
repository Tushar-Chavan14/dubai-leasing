import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@platform/ui", "@spa/core"],
  // The staff app talks to the SPA engine server-side only; the browser never sees the session token.
  poweredByHeader: false,
  // Set by the Next.js security upgrade (16.4.2 → 16.4.6).
  experimental: { agentUpgrade: "security" },
};

export default config;
