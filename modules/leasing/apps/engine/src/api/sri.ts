import { Emirate } from "@leasing/core";
import { sriAverages, withTx } from "@leasing/db";
import { asc } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { saveSriValue } from "../manager/sri-values.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const actorOf = (c: { get(k: "user"): { id: string } }) => `user:${c.get("user").id}` as const;

/** The Smart Rental Index table. Always on: pricing (slice 1) reads it, with or without TENANCY_OPS. */
export function registerSriRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;
  api.get("/sri", async (c) =>
    c.json(
      await db
        .select()
        .from(sriAverages)
        .orderBy(
          asc(sriAverages.emirate),
          asc(sriAverages.community),
          asc(sriAverages.category),
          asc(sriAverages.bedrooms),
        ),
    ),
  );

  api.put("/sri", async (c) => {
    requireRole(c.get("user"), ["admin", "leasing_manager"]);
    const b = z
      .object({
        emirate: Emirate.default("dubai"),
        community: z.string().trim().min(1).max(120),
        bedrooms: z.number().int().min(0).max(10),
        avgAnnualRentFils: z.number().int().positive().max(100_000_000_00),
      })
      .parse(await c.req.json());
    const row = await withTx(ctx.database, (tx) => saveSriValue(ctx, tx, b, actorOf(c)));
    return c.json(row);
  });
}
