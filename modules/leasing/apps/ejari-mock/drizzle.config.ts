import { defineConfig } from "drizzle-kit";

// Generates this service's own migrations for the `ejari_mock` schema; it needs no database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  schemaFilter: ["ejari_mock"],
});
