import { isComplianceGate, SpaGateId } from "@spa/core";
import { deals, spaApprovals } from "@spa/db";
import { and, count, eq, inArray, notInArray } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { TERMINAL } from "./reads.ts";

/** What the module chooser may know (S69): two integers, no name, id, role or compliance count. Reads only SPA's own tables. */
export interface LauncherSummary {
  openWork: number;
  waitingApprovals: number;
}

/** Waiting approvals leave out the compliance gates, so no compliance number leaves the module. */
const NON_COMPLIANCE_GATES = SpaGateId.options.filter((g) => !isComplianceGate(g));

export async function launcherSummary(ctx: SpaContext): Promise<LauncherSummary> {
  const db = ctx.database.db;
  const [open] = await db.select({ n: count() }).from(deals).where(notInArray(deals.state, TERMINAL));
  const [waiting] = await db
    .select({ n: count() })
    .from(spaApprovals)
    .where(and(eq(spaApprovals.status, "pending"), inArray(spaApprovals.gate, NON_COMPLIANCE_GATES)));
  return { openWork: Number(open!.n), waitingApprovals: Number(waiting!.n) };
}
