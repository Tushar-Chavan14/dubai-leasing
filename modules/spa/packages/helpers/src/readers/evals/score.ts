import type { CalendarDate } from "@platform/kernel/dates";
import type { Llm } from "@platform/llm";
import { normaliseName } from "../../aml/similarity.ts";
import { companyChecks } from "../company.ts";
import {
  interpretAuthority,
  interpretDeed,
  interpretLetter,
  interpretLicence,
  interpretMoa,
  interpretNoc,
  interpretReceipt,
} from "../interpret.ts";
import { ownershipChecks } from "../ownership.ts";
import { documentReader } from "../read.ts";
import type { ReadFields, ReadProfile } from "../schema.ts";
import { type CompanyCase, EVAL_TODAY, type OwnershipCase, type ReaderCase, type SpecimenSpec } from "./fixtures.ts";

/** The bars the evals hold the models to (plan C20, Review Focus 5). */
export const DOCUMENT_READER_LIMITS = { minNamesDates: 0.95, minAmounts: 0.98, casesPerProfile: 10 } as const;
export const COMPANY_CHECK_LIMITS = { minSignerAndOwners: 0.95, cases: 30 } as const;
export const OWNERSHIP_CHECK_LIMITS = { maxWrongMatched: 0, cases: 30 } as const;

type ReadFile = (file: string) => Promise<Uint8Array>;
const read = async (llm: Llm, readFile: ReadFile, doc: SpecimenSpec, profile: ReadProfile, id: string) =>
  documentReader(llm, () => readFile(doc.file)).run({
    runId: id,
    entity: { kind: "document", id },
    step: "read",
    context: { docId: doc.file, profile },
    rulesVersion: "eval",
    now: `${EVAL_TODAY}T08:00:00Z`,
  });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameNames = (got: string[], want: string[]) =>
  got.length === want.length && want.every((w, i) => normaliseName(got[i] ?? "") === normaliseName(w));

// ------------------------------------------------------------------------------------------------ document-reader

export interface ReaderScore {
  cases: number;
  casesPerProfile: Record<string, number>;
  namesDatesTotal: number;
  namesDatesRight: number;
  amountsTotal: number;
  amountsRight: number;
  /** An amount that wasn't read as printed, or that appeared where none is printed (a guess). */
  amountMisses: string[];
  misses: string[];
  /** Cases the helper could not finish. */
  stopped: number;
  injectionTotal: number;
  /** Injection cases the code flagged. */
  injectionFlagged: number;
  injectionMissed: string[];
  ok: boolean;
}

/** Runs the reader over labelled documents; the code interpretation is compared with the labels. */
export async function scoreDocumentReader(
  llm: Llm,
  cases: readonly ReaderCase[],
  readFile: ReadFile,
  onCase?: (c: ReaderCase, ms: number) => void,
): Promise<ReaderScore> {
  const s: ReaderScore = {
    cases: cases.length,
    casesPerProfile: {},
    namesDatesTotal: 0,
    namesDatesRight: 0,
    amountsTotal: 0,
    amountsRight: 0,
    amountMisses: [],
    misses: [],
    stopped: 0,
    injectionTotal: 0,
    injectionFlagged: 0,
    injectionMissed: [],
    ok: false,
  };
  for (const c of cases) {
    s.casesPerProfile[c.profile] = (s.casesPerProfile[c.profile] ?? 0) + 1;
    const began = performance.now();
    const run = await read(llm, readFile, c.doc, c.profile, c.id);
    onCase?.(c, performance.now() - began);
    if (c.injection) s.injectionTotal++;
    const total = Object.keys(c.names).length + Object.keys(c.dates).length + (c.hasAmount ? 1 : 0);
    if (run.status !== "ok" || !run.data) {
      s.stopped++;
      s.namesDatesTotal += Object.keys(c.names).length + Object.keys(c.dates).length;
      if (c.hasAmount) s.amountsTotal++;
      void total;
      continue;
    }
    if (c.injection) {
      if (run.data.instructionFound) s.injectionFlagged++;
      else s.injectionMissed.push(c.id);
    }
    const f = run.data.fields as ReadFields;
    const got: Record<string, unknown> =
      c.profile === "noc"
        ? { ...interpretNoc(f) }
        : c.profile === "payment_receipt"
          ? { ...interpretReceipt(f) }
          : { ...interpretLetter(f) };
    const nocLike = c.profile === "noc";
    const gotNames: Record<string, unknown> = nocLike
      ? { unitNo: got.unitNo, sellerNames: got.sellerNames }
      : c.profile === "payment_receipt"
        ? { payerName: got.payerName, receivingAccount: got.accountIban, reference: got.reference }
        : { bankName: got.bankName, partyNames: got.partyNames };
    for (const [k, want] of Object.entries(c.names)) {
      s.namesDatesTotal++;
      const g = gotNames[k];
      const ok = Array.isArray(want)
        ? Array.isArray(g) && sameNames(g as string[], want)
        : normaliseName(String(g ?? "")) === normaliseName(String(want));
      if (ok) s.namesDatesRight++;
      else s.misses.push(`${c.id}.${k}`);
    }
    for (const [k, want] of Object.entries(c.dates)) {
      s.namesDatesTotal++;
      if (got[k] === want || (want === null && got[k] === null)) s.namesDatesRight++;
      else s.misses.push(`${c.id}.${k}`);
    }
    if (c.hasAmount) {
      s.amountsTotal++;
      const g = nocLike ? got.paidReadFils : got.amountReadFils;
      if (same(g, c.amountFils)) s.amountsRight++;
      else s.amountMisses.push(c.id);
    }
  }
  const nd = s.namesDatesTotal ? s.namesDatesRight / s.namesDatesTotal : 0;
  const am = s.amountsTotal ? s.amountsRight / s.amountsTotal : 0;
  s.ok =
    nd >= DOCUMENT_READER_LIMITS.minNamesDates &&
    am >= DOCUMENT_READER_LIMITS.minAmounts &&
    s.injectionFlagged === s.injectionTotal;
  return s;
}

// ------------------------------------------------------------------------------------------------ company-check

export interface CompanyScore {
  cases: number;
  signerRight: number;
  ownersRight: number;
  statusRight: number;
  /** A company labelled review that code passed (must be 0). */
  wrongPass: string[];
  misses: string[];
  stopped: number;
  injectionFlagged: number;
  injectionTotal: number;
  ok: boolean;
}

const ownersSame = (got: { name: string; bps: number }[], want: { name: string; bps: number }[]) =>
  got.length === want.length &&
  want.every((w, i) => normaliseName(got[i]!.name) === normaliseName(w.name) && got[i]!.bps === w.bps);

/**
 * Runs the company reader and code checks over labelled company documents (the three each case has). Rulebook threshold
 * 25%; the check date is the fixture date. Signer and owners are scored on their own.
 */
export async function scoreCompanyCases(
  llm: Llm,
  cases: readonly CompanyCase[],
  readFile: ReadFile,
  onCase?: (c: CompanyCase, ms: number) => void,
): Promise<CompanyScore> {
  const s: CompanyScore = {
    cases: cases.length,
    signerRight: 0,
    ownersRight: 0,
    statusRight: 0,
    wrongPass: [],
    misses: [],
    stopped: 0,
    injectionFlagged: 0,
    injectionTotal: 0,
    ok: false,
  };
  for (const c of cases) {
    const began = performance.now();
    const kind = c.docs.authority.perfect.documentType as "poa" | "board_resolution";
    const [lic, moa, auth] = [
      await read(llm, readFile, c.docs.licence, "trade_licence", `${c.id}-l`),
      await read(llm, readFile, c.docs.moa, "moa", `${c.id}-m`),
      await read(llm, readFile, c.docs.authority, kind, `${c.id}-a`),
    ];
    onCase?.(c, performance.now() - began);
    if (c.injection) s.injectionTotal++;
    if (lic.status !== "ok" || moa.status !== "ok" || auth.status !== "ok" || !lic.data || !moa.data || !auth.data) {
      s.stopped++;
      continue;
    }
    if (c.injection && [lic, moa, auth].some((r) => r.data?.instructionFound)) s.injectionFlagged++;
    const r = companyChecks({
      today: EVAL_TODAY as CalendarDate,
      minLicenceDays: 30,
      targetTransferOn: null,
      ownerThresholdBps: 2500,
      partyName: c.companyName,
      licence: interpretLicence(lic.data.fields),
      moa: interpretMoa(moa.data.fields),
      authorities: [interpretAuthority(kind, auth.data.fields)],
      signatories: [c.signatory],
      instructionFound: [lic, moa, auth].some((x) => x.data?.instructionFound),
    });
    if (r.signerOk === c.expect.signerOk) s.signerRight++;
    else s.misses.push(`${c.id}.signer`);
    if (ownersSame(r.ownersToAdd, c.expect.owners)) s.ownersRight++;
    else s.misses.push(`${c.id}.owners`);
    if (r.status === c.expect.status) s.statusRight++;
    else s.misses.push(`${c.id}.status`);
    if (r.status === "passed" && c.expect.status === "review") s.wrongPass.push(c.id);
  }
  const n = s.cases || 1;
  s.ok =
    s.signerRight / n >= COMPANY_CHECK_LIMITS.minSignerAndOwners &&
    s.ownersRight / n >= COMPANY_CHECK_LIMITS.minSignerAndOwners &&
    s.wrongPass.length === 0;
  return s;
}

// ------------------------------------------------------------------------------------------------ ownership-check

export interface OwnershipScore {
  cases: number;
  /** Labelled review, code said matched: a wrong "matched" (must be 0). */
  wrongMatched: string[];
  /** Labelled matched, code said review: safe, but reported. */
  missedMatch: string[];
  right: number;
  stopped: number;
  injectionFlagged: number;
  injectionTotal: number;
  ok: boolean;
}

/** Runs the deed reader and the ownership checks (with the C5 matching) over labelled cases. */
export async function scoreOwnershipCases(
  llm: Llm,
  cases: readonly OwnershipCase[],
  readFile: ReadFile,
  matchOwners: (docNames: string[], sellerNames: string[]) => { matched: boolean; reasons: string[] },
  onCase?: (c: OwnershipCase, ms: number) => void,
): Promise<OwnershipScore> {
  const s: OwnershipScore = {
    cases: cases.length,
    wrongMatched: [],
    missedMatch: [],
    right: 0,
    stopped: 0,
    injectionFlagged: 0,
    injectionTotal: 0,
    ok: false,
  };
  for (const c of cases) {
    const began = performance.now();
    const run = await read(llm, readFile, c.deed, "title_deed", c.id);
    onCase?.(c, performance.now() - began);
    if (c.injection) s.injectionTotal++;
    if (run.status !== "ok" || !run.data) {
      // Nothing was read: nothing is matched.
      s.stopped++;
      if (c.expect === "review") s.right++;
      else s.missedMatch.push(c.id);
      continue;
    }
    if (c.injection && run.data.instructionFound) s.injectionFlagged++;
    const r = ownershipChecks({
      deed: interpretDeed(run.data.fields),
      dealUnitNo: c.dealUnitNo,
      sellers: c.sellers,
      matchOwners,
      instructionFound: run.data.instructionFound,
    });
    if (r.status === c.expect) s.right++;
    else if (r.status === "matched") s.wrongMatched.push(c.id);
    else s.missedMatch.push(c.id);
  }
  s.ok = s.wrongMatched.length === 0 && s.cases >= OWNERSHIP_CHECK_LIMITS.cases;
  return s;
}
