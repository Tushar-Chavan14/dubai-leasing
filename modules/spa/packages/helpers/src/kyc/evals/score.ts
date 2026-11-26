import { readFileSync } from "node:fs";
import type { CalendarDate } from "@platform/kernel/dates";
import type { Llm } from "@platform/llm";
import { starterKycConfig } from "@spa/core";
import { spaKycContext, spaKycHelper } from "../index.ts";

/** One labelled specimen: a single fictional document, and what a correct reading and check must give. */
export interface KycEvalCase {
  id: string;
  title: string;
  today: string;
  applicant: { nameEn: string };
  document: { file: string; kind: "passport" | "emirates_id_front" };
  expect: { expired: boolean; fields: Record<string, string> };
}

/** The limits `bun run eval -- spa:kyc` holds the model to (plan C17, Review Focus 5). */
export const KYC_EVAL_LIMITS = { minFieldsExact: 0.95 } as const;

export const loadKycCases = (): KycEvalCase[] =>
  readFileSync(new URL("./specimens/cases.jsonl", import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as KycEvalCase);

export interface KycEvalScore {
  cases: number;
  fieldsTotal: number;
  fieldsRight: number;
  /** Expired documents the check let through (must be 0). */
  expiredPassed: number;
  expiredBlocked: number;
  validVerified: number;
  /** Cases the helper could not finish (model down, unreadable). */
  stopped: number;
  /** Per field: wrong readings, for the report (the case id and field name, never the value). */
  misses: string[];
  /** Both limits hold. */
  ok: boolean;
}

/**
 * Runs the SPA KYC reader over labelled specimens and scores it. Fields are compared with the identity the code
 * checks produced; an expired document passes if no blocking `expired` flag was raised. Reads each file through
 * `readImage` and calls only the `llm` it is given (a local model; documents never leave the machine).
 */
export async function scoreKycCases(
  llm: Llm,
  cases: readonly KycEvalCase[],
  readImage: (file: string) => Promise<Uint8Array>,
  onCase?: (c: KycEvalCase, ms: number) => void,
): Promise<KycEvalScore> {
  const s: KycEvalScore = {
    cases: cases.length,
    fieldsTotal: 0,
    fieldsRight: 0,
    expiredPassed: 0,
    expiredBlocked: 0,
    validVerified: 0,
    stopped: 0,
    misses: [],
    ok: false,
  };
  const helper = spaKycHelper(llm, readImage);
  for (const c of cases) {
    const began = performance.now();
    const run = await helper.run({
      runId: c.id,
      entity: { kind: "party", id: c.id },
      step: "kyc",
      context: spaKycContext({
        config: starterKycConfig("buyer_person"),
        partyName: c.applicant.nameEn,
        documents: [{ docId: c.document.file, kind: c.document.kind }],
        today: c.today as CalendarDate,
      }),
      rulesVersion: "eval",
      now: `${c.today}T08:00:00Z`,
    });
    onCase?.(c, performance.now() - began);
    const data = run.status === "ok" ? run.data : undefined;
    if (!data) {
      s.stopped++;
      s.fieldsTotal += Object.keys(c.expect.fields).length;
      // A stopped check passes nothing: an expired document is not let through by it.
      if (c.expect.expired) s.expiredBlocked++;
      continue;
    }
    for (const [field, want] of Object.entries(c.expect.fields)) {
      s.fieldsTotal++;
      if ((data.identity as Record<string, unknown>)[field] === want) s.fieldsRight++;
      else s.misses.push(`${c.id}.${field}`);
    }
    const blocked = data.flags.some((f) => f.kind === "expired" && f.blocking);
    if (c.expect.expired) {
      if (blocked && data.verdict === "review") s.expiredBlocked++;
      else s.expiredPassed++;
    } else if (data.verdict === "verified") s.validVerified++;
  }
  s.ok = s.fieldsTotal > 0 && s.fieldsRight / s.fieldsTotal >= KYC_EVAL_LIMITS.minFieldsExact && s.expiredPassed === 0;
  return s;
}
