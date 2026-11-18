import { defineConfig } from "drizzle-kit";
import { loadSpaEnv } from "@spa/core/env";

// The SPA database only (S2), from `.env.spa.local` only (S25). `generate` needs no database, so a missing or
// incomplete file is fine there; `bun run spa:db:migrate` uses src/migrate.ts, which validates the file.
const databaseUrl = (): string => {
  try {
    return loadSpaEnv().SPA_DATABASE_URL;
  } catch {
    return "";
  }
};

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: databaseUrl() },
});
