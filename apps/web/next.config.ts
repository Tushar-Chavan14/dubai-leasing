import type { NextConfig } from "next";

/** Old staff routes → new shell (slice 2). Temporary (307) so they can still change. */
const moved: { source: string; destination: string }[] = [
  { source: "/inbox", destination: "/work?view=waiting" },
  { source: "/inbox/:id", destination: "/work?approval=:id" },
  { source: "/applications/:id((?!new$)[^/]+)", destination: "/work?kind=application&id=:id" },
  { source: "/leases/:id", destination: "/work?kind=lease&id=:id" },
  { source: "/conversations", destination: "/work?stage=Enquiry" },
  { source: "/copilot", destination: "/" },
  { source: "/rules", destination: "/settings/rulebook" },
  { source: "/rules/:version", destination: "/settings/rulebook/:version" },
  { source: "/sri", destination: "/settings/rent-index" },
  { source: "/import", destination: "/settings/import" },
  { source: "/demo", destination: "/settings/demo" },
];

/** The old public site → the customer section (slice 3). Temporary (307). */
const customer: { source: string; destination: string }[] = [
  { source: "/properties", destination: "/customer/properties" },
  { source: "/properties/:id", destination: "/customer/properties/:id" },
  { source: "/chat", destination: "/customer/chat" },
];

const config: NextConfig = {
  transpilePackages: ["@leasing/core"],
  // Staff app talks to the engine server-side only; the browser never sees the session token.
  poweredByHeader: false,
  async redirects() {
    return [...moved, ...customer].map((r) => ({ ...r, permanent: false }));
  },
};

export default config;
