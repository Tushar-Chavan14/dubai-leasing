import { registrationDocumentOptions } from "../manager/registration-settings.ts";
import type { Hono } from "hono";
import { withTx } from "@leasing/db";
import { Emirate } from "@leasing/core";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import {
  companySettings,
  contractStatus,
  emirateSetup,
  listCompanies,
  unitWithPricing,
  viewingSlotsFor,
} from "../manager/copilot-reads.ts";
import { notFound } from "../errors.ts";
import { resolveCompany } from "../manager/availability.ts";
import { kycCopilotView } from "../manager/kyc-config.ts";
import { listRecordsCounted, pipelineSummary, STAGES } from "../manager/workspace.ts";
import type { AuthEnv } from "./auth.ts";

/**
 * Read routes for the staff copilot's pipeline tools (architecture §8b). Any signed-in staff role
 * may read; nothing here writes. Counts come from the same code as the Home tiles.
 */
export function registerCopilotReadRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  api.get("/copilot/pipeline", async (c) => c.json(await pipelineSummary(ctx, c.get("user"))));
  api.get("/copilot/companies", async (c) => c.json(await listCompanies(ctx)));
  /** A company's rent rules, contract rules, approved clauses and the SRI table (D45). */
  api.get("/copilot/company-settings", async (c) => {
    const text = z.string().trim().min(2).max(120).parse(c.req.query("company"));
    const hit = await withTx(ctx.database, (tx) => resolveCompany(tx, ctx.clock.today(), text));
    if (!hit.ok) throw notFound(hit.reason === "ambiguous" ? `company (one of: ${hit.names.join(", ")})` : "company");
    return c.json({ company: hit.name, ...(await companySettings(ctx, hit.id)) });
  });
  /** A company's document form and KYC checks, draft first (D50). */
  api.get("/copilot/kyc-config", async (c) => {
    const text = z.string().trim().min(2).max(200).parse(c.req.query("company"));
    const hit = await withTx(ctx.database, (tx) => resolveCompany(tx, ctx.clock.today(), text));
    if (!hit.ok) throw notFound(hit.reason === "ambiguous" ? `company (one of: ${hit.names.join(", ")})` : "company");
    return c.json({
      company: hit.name,
      ...(await withTx(ctx.database, (tx) => kycCopilotView(tx, hit.id, ctx.clock.today()))),
    });
  });
  api.get("/copilot/contract-status", async (c) =>
    c.json(await contractStatus(ctx, z.string().trim().min(2).max(80).parse(c.req.query("ref")))),
  );
  /** One unit with its SRI band and rent rule limits, computed by the engine (D42). */
  api.get("/copilot/unit", async (c) =>
    c.json(await unitWithPricing(ctx, z.string().trim().min(2).max(60).parse(c.req.query("ref")))),
  );
  /** Registration system, rulebook, rent index and registration fee per emirate (T7); values come from code. */
  api.get("/copilot/emirate-setup", async (c) => {
    const q = z
      .object({ emirate: Emirate.optional(), annualRentFils: z.coerce.number().int().positive().optional() })
      .parse(c.req.query());
    return c.json({
      emirates: await emirateSetup(ctx, q.emirate, q.annualRentFils),
      documentOptions: await withTx(ctx.database, (tx) => registrationDocumentOptions(ctx, tx)),
    });
  });
  /** Free viewing slots for a unit (id or code) or for an application's unit (D42). */
  api.get("/copilot/viewing-slots", async (c) => {
    const q = z
      .object({ unit: z.string().trim().min(2).max(60).optional(), applicationId: z.uuid().optional() })
      .refine((v) => Boolean(v.unit) !== Boolean(v.applicationId), "give a unit or an applicationId")
      .parse(c.req.query());
    return c.json(await viewingSlotsFor(ctx, q));
  });
  /** The Workspace's records, filtered the same way, with the match count and the stage list. */
  api.get("/copilot/records", async (c) => {
    const q = z
      .object({
        stage: z.enum(STAGES).optional(),
        q: z.string().trim().max(100).optional(),
        company: z.string().trim().min(2).max(120).optional(),
        category: z.enum(["residential", "commercial", "retail"]).optional(),
        mine: z.enum(["0", "1"]).optional(),
        id: z.uuid().optional(),
        limit: z.coerce.number().int().min(1).max(20).default(10),
      })
      .parse(c.req.query());
    let companyId: string | undefined;
    if (q.company) {
      const hit = await withTx(ctx.database, (tx) => resolveCompany(tx, ctx.clock.today(), q.company!));
      if (!hit.ok)
        throw notFound(
          hit.reason === "ambiguous"
            ? `company (several match: ${hit.names.join("; ")})`
            : `company (companies with listings: ${hit.names.join("; ")})`,
        );
      companyId = hit.id;
    }
    const { rows, total } = await listRecordsCounted(ctx.database.db, c.get("user"), {
      stage: q.stage,
      q: q.q,
      id: q.id,
      companyId,
      category: q.category,
      mine: q.mine === undefined ? undefined : q.mine === "1",
      limit: q.limit,
    });
    return c.json({ total, rows });
  });
}
