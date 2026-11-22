import { defineConfig } from "drizzle-kit";

// `generate` needs no database. `bun run portal:db:migrate` (scripts/migrate.ts) reads `.env.portal.local` only.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "postgres://unused@localhost/portal" },
});
