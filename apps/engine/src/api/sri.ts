import { newId } from "@leasing/core";
import { sriAverages } from "@leasing/db";
import { asc } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
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
        .orderBy(asc(sriAverages.community), asc(sriAverages.category), asc(sriAverages.bedrooms)),
    ),
  );

  api.put("/sri", async (c) => {
    requireRole(c.get("user"), ["admin", "leasing_manager"]);
    const b = z
      .object({
        community: z.string().trim().min(1).max(120),
        bedrooms: z.number().int().min(0).max(10),
        avgAnnualRentFils: z.number().int().positive().max(100_000_000_00),
      })
      .parse(await c.req.json());
    const today = ctx.clock.today();
    const [row] = await db
      .insert(sriAverages)
      .values({
        id: newId(),
        ...b,
        category: "residential",
        source: "manual",
        effectiveFrom: today,
        createdBy: actorOf(c),
      })
      .onConflictDoUpdate({
        target: [sriAverages.community, sriAverages.category, sriAverages.bedrooms, sriAverages.effectiveFrom],
        set: { avgAnnualRentFils: b.avgAnnualRentFils, source: "manual", createdBy: actorOf(c) },
      })
      .returning();
    return c.json(row);
  });
}
