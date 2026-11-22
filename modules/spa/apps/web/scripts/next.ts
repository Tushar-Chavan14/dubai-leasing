import { readdirSync } from "node:fs";
import { loadSpaEnv } from "@spa/core/env";

/**
 * Starts Next on SPA_WEB_PORT. `.env.spa.local` is validated first, so a missing key stops here (S25). The server code
 * reads settings only through `loadSpaEnv`. Next would also load any `.env*` file in this folder, so none may exist.
 */
const stray = readdirSync(`${import.meta.dir}/..`).filter((f) => f.startsWith(".env"));
if (stray.length)
  throw new Error(`remove ${stray.join(", ")} from modules/spa/apps/web: SPA settings live only in .env.spa.local`);
const mode = process.argv[2] === "start" ? "start" : "dev";
const env = loadSpaEnv();
const child = Bun.spawn(["bun", "x", "next", mode, "-p", String(env.SPA_WEB_PORT), "-H", "127.0.0.1"], {
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.exit(await child.exited);
