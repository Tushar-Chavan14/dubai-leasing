import { addYears, type Actor, type CalendarDate, DEMO_COMPANY_LEGAL, luhnCheckDigit } from "@leasing/core";
import { companies, withTx } from "@leasing/db";
import { asc } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import {
  type CompanyLegal,
  CompanyLegalInput,
  legalView,
  lookupCompanyLandlord,
  updateCompanyLegal,
} from "./company-legal.ts";

/** Stable small number from a string (FNV-1a), so generated demo values don't change between runs. */
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Fictional Emirates ID: birth year 1900 (no real holder), valid check digit. */
function fictionalEid(serial: number): string {
  const s = String(serial).padStart(7, "0");
  return `784-1900-${s}-${luhnCheckDigit(`7841900${s}`)}`;
}

/** Fictional legal details for a company: the demo set when its slug is known, else derived from its name. */
export function demoLegalFor(company: { name: string; slug: string }, today: CalendarDate): CompanyLegalInput {
  const known = DEMO_COMPANY_LEGAL[company.slug];
  if (known) {
    const { signatoryEidSerial, reraOrn, ...rest } = known;
    return {
      ...rest,
      reraOrn,
      signatoryIdKind: "emirates_id",
      signatoryIdNo: fictionalEid(Number(signatoryEidSerial)),
    };
  }
  const h = hash(company.slug);
  const expiry = addYears(today, 2);
  const legalName = `${company.name} LLC`;
  return {
    legalNameEn: legalName,
    legalNameAr: null,
    tradeLicenceNo: `DEMO-TL-${String(h % 100000).padStart(5, "0")}`,
    tradeLicenceAuthority: "Dubai Economy and Tourism (demo)",
    tradeLicenceExpiresOn: expiry,
    reraOrn: null,
    registeredAddress: "Demo address, Dubai",
    email: `legal@${company.slug}.demo.example`,
    phone: `+971 4 000 ${String(h % 10000).padStart(4, "0")}`,
    chequePayeeName: legalName,
    signatoryName: `Demo Signatory ${company.name}`,
    signatoryTitle: "Leasing Director",
    signatoryEmail: `signatory@${company.slug}.demo.example`,
    signatoryIdKind: "emirates_id",
    signatoryIdNo: fictionalEid(3_000_000 + (h % 1_000_000)),
    signatoryIdExpiresOn: expiry,
  };
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

export interface FillResult {
  company: string;
  /** Names of the fields that were filled; no values. */
  filled: string[];
  error?: string;
}

/**
 * Demo only: fills the missing legal fields of every company with fictional values, through the audited Manager
 * update. Filled values are never overwritten, so a second run changes nothing.
 */
export async function fillMissingCompanyLegal(ctx: EngineContext, actor: Actor = "system:demo"): Promise<FillResult[]> {
  if (!ctx.demoMode) throw new Error("filling legal details with fictional values needs DEMO_MODE=true");
  const today = ctx.clock.today();
  const all = await ctx.database.db.select().from(companies).orderBy(asc(companies.name));
  const results: FillResult[] = [];
  for (const c of all) {
    try {
      const filled = await withTx(ctx.database, async (tx) => {
        const { company, party } = await lookupCompanyLandlord(tx, c.id);
        const current: CompanyLegal = legalView(company, party);
        // The party starts out named after the company; that default is not a legal name yet.
        if (current.legalNameEn === company.name) current.legalNameEn = null;
        const demo = demoLegalFor(company, today);
        const merged = { ...demo } as Record<string, unknown>;
        const filled: string[] = [];
        for (const k of Object.keys(demo) as (keyof CompanyLegalInput)[]) {
          if (blank(current[k])) {
            if (!blank(demo[k])) filled.push(k);
          } else merged[k] = current[k];
        }
        // A stored ID number with no kind is an Emirates ID, the only kind the form offers by default.
        if (!blank(current.signatoryIdNo) && blank(current.signatoryIdKind)) merged.signatoryIdKind = "emirates_id";
        if (!filled.length) return [];
        const parsed = CompanyLegalInput.parse(merged);
        await updateCompanyLegal(ctx, tx, c.id, parsed, actor);
        return filled;
      });
      results.push({ company: c.name, filled });
    } catch (e) {
      // Zod and domain messages name fields, not values; ID numbers are never echoed.
      results.push({ company: c.name, filled: [], error: e instanceof Error ? e.message.slice(0, 200) : "failed" });
    }
  }
  return results;
}
