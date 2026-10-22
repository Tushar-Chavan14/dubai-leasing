import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@leasing/core"],
  // Staff app talks to the engine server-side only; the browser never sees the session token.
  poweredByHeader: false,
};

export default config;
