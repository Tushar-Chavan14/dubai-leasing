import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@platform/ui", "@spa/core"],
  // The staff app talks to the SPA engine server-side only; the browser never sees the session token.
  poweredByHeader: false,
  // S75: a project's page moved under /inventory/projects; an old link with its id still lands there.
  async redirects() {
    return [
      // S78: the M1-era emailed link /listings/L-0007 lands on the public page; a staff /listings/<uuid> is untouched.
      { source: "/listings/:ref(L-\\d+)", destination: "/properties/:ref", permanent: true },
      // A leasing-style address lands on the sales catalogue.
      { source: "/customer/properties/:path*", destination: "/properties/:path*", permanent: true },
      {
        source: "/inventory/:id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
        destination: "/inventory/projects/:id",
        permanent: true,
      },
    ];
  },
  // Set by the Next.js security upgrade (16.4.2 → 16.4.6).
  experimental: { agentUpgrade: "security" },
};

export default config;
