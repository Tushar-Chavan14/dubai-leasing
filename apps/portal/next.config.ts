import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@platform/ui"],
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  // Same upgrade flag as the two module apps (Next.js 16.4.2 to 16.4.6).
  experimental: { agentUpgrade: "security" },
};
export default config;
