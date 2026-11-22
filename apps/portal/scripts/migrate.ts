import { createPortalDatabase, runPortalMigrations } from "../lib/db.ts";
import { loadPortalEnv } from "../lib/env.ts";

const url = loadPortalEnv().PORTAL_DATABASE_URL;
if (!url) throw new Error("PORTAL_DATABASE_URL is not set in .env.portal.local");
const database = createPortalDatabase(url, { max: 1 });
await runPortalMigrations(database);
await database.close();
console.log("portal migrations applied");
