import { Emirate } from "@leasing/core";
import { withTx } from "@leasing/db";
import type { Hono } from "hono";
import type { EngineContext } from "../context.ts";
import {
  allSettings,
  registrationDocumentOptions,
  saveRegistrationSettings,
  settingsFor,
} from "../manager/registration-settings.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

/** Per-emirate registration settings: any staff reads, admins write. */
export function registerRegistrationSettingsRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  api.get("/registration-settings", async (c) => c.json(await withTx(ctx.database, (tx) => allSettings(ctx, tx))));

  // Before /:emirate. What a checklist can include, from every company's KYC form (D62).
  api.get("/registration-settings/document-options", async (c) =>
    c.json(await withTx(ctx.database, (tx) => registrationDocumentOptions(ctx, tx))),
  );
  api.get("/registration-settings/:emirate", async (c) => {
    const emirate = Emirate.parse(c.req.param("emirate"));
    return c.json(await withTx(ctx.database, (tx) => settingsFor(ctx, tx, emirate)));
  });

  api.put("/registration-settings/:emirate", async (c) => {
    requireRole(c.get("user"), ["admin"]);
    const emirate = Emirate.parse(c.req.param("emirate"));
    const body = await c.req.json();
    const actor = `user:${c.get("user").id}` as const;
    return c.json(await withTx(ctx.database, (tx) => saveRegistrationSettings(ctx, tx, emirate, body, actor)));
  });
}
