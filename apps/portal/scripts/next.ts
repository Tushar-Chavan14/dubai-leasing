import { loadPortalEnv } from "../lib/env.ts";

/**
 * Starts Next on PORTAL_PORT. `.env.portal.local` is validated first, so a bad key stops here (S25). Server code reads
 * settings only through `portalEnv()`. Next would also load any `.env*` file in this folder, so none may exist.
 */
import { readdirSync } from "node:fs";
const stray = readdirSync(`${import.meta.dir}/..`).filter((f) => f.startsWith(".env"));
if (stray.length)
  throw new Error(`remove ${stray.join(", ")} from apps/portal: portal settings live only in .env.portal.local`);
const mode = process.argv[2] === "start" ? "start" : "dev";
const env = loadPortalEnv();
const child = Bun.spawn(["bun", "x", "--bun", "next", mode, "-p", String(env.PORTAL_PORT), "-H", "127.0.0.1"], {
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.exit(await child.exited);
