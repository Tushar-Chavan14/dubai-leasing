import { describe, expect, test } from "bun:test";
import { FakeLlm } from "@platform/llm";
import { z } from "zod";
import { assessKyc, kycAiChecks, kycHelper, type KycProfile, ReadField } from "../src/kyc/index.ts";
import type { CalendarDate } from "@platform/kernel/dates";
import type { DocRead, KycContext } from "../src/kyc/schema.ts";
import { readPrompt } from "../src/kyc/prompt.ts";

const hi = (value: string | null, confidence = 0.97) => ({ value, confidence });
const POA = z.object({
  documentType: z.enum(["proof_of_address", "passport", "other"]),
  holderName: ReadField,
  issueDate: ReadField,
});
const profile: KycProfile = {
  helperName: "sample",
  orgNoun: "agency",
  partyNoun: "party",
  documents: { passport: "a passport", proof_of_address: "a utility bill" },
  documentLabels: { passport: "passport", proof_of_address: "proof of address" },
  mrzKeys: [],
  aiCheckSubject: "an agency set for client documents",
  extraReads: { proof_of_address: POA },
  personDocs: "any_id",
};
const ctx = (docs: KycContext["documents"], over: Partial<KycContext> = {}): KycContext => ({
  applicant: { nameEn: "Priya Example Rao", kind: "individual" },
  leaseStartOn: "2026-11-19" as CalendarDate,
  today: "2026-11-19" as CalendarDate,
  minValidityDays: 30,
  minConfidence: 0.8,
  documents: docs,
  ...over,
});
const extraDoc = { docId: "a", kind: "extra" as const, side: "page" as const, fieldKey: "proof_of_address" };

describe("extra reads (a profile's own document kinds)", () => {
  test("the extra document is read with the profile's schema, prompt and label", async () => {
    const llm = new FakeLlm(
      () => new Error("no decide"),
      () => ({ documentType: "proof_of_address", holderName: hi("Priya Example Rao"), issueDate: hi("01/11/2026") }),
    );
    const run = await kycHelper(llm, async () => new Uint8Array([1]), profile).run({
      runId: "r",
      entity: { kind: "party", id: "p" },
      step: "kyc",
      context: ctx([extraDoc]),
      rulesVersion: "v",
      now: "2026-11-19T00:00:00Z",
    });
    expect(llm.visionCalls[0]!.prompt).toStartWith("This image should be a utility bill.");
    expect(run.status).toBe("ok");
    expect(run.data?.flags.filter((f) => f.kind === "wrong_document" || f.kind === "unreadable")).toEqual([]);
  });

  test("the wrong kind of document is flagged and a low-confidence holder is not clear", () => {
    const reads: DocRead[] = [
      {
        docId: "a",
        kind: "extra",
        side: "page",
        fieldKey: "proof_of_address",
        read: { documentType: "other", holderName: hi("Priya Example Rao", 0.3), issueDate: hi("01/11/2026") },
      },
    ];
    const kinds = assessKyc(ctx([extraDoc]), reads, { personDocs: "any_id" }).flags.map((f) => f.kind);
    expect(kinds).toContain("wrong_document");
    expect(kinds).toContain("low_confidence");
  });

  test("an extra document the profile has no schema for is unreadable and never sent to the model", async () => {
    const llm = new FakeLlm(
      () => new Error("no decide"),
      () => {
        throw new Error("must not be called");
      },
    );
    const run = await kycHelper(llm, async () => new Uint8Array([1]), profile).run({
      runId: "r",
      entity: { kind: "party", id: "p" },
      step: "kyc",
      context: ctx([{ ...extraDoc, fieldKey: "title_deed" }]),
      rulesVersion: "v",
      now: "2026-11-19T00:00:00Z",
    });
    expect(llm.visionCalls).toHaveLength(0);
    expect(run.data?.flags.map((f) => f.kind)).toContain("unreadable");
    expect(run.data?.verdict).toBe("review");
  });

  test("a name on an extra document that differs from the passport is a mismatch", () => {
    const passport: DocRead = {
      docId: "p",
      kind: "passport",
      side: "page",
      read: null,
    };
    const poa: DocRead = {
      docId: "a",
      kind: "extra",
      side: "page",
      fieldKey: "proof_of_address",
      read: { documentType: "proof_of_address", holderName: hi("Someone Else"), issueDate: hi("01/11/2026") },
    };
    const d = assessKyc(ctx([extraDoc]), [poa, passport], { personDocs: "any_id" });
    expect(d.flags.some((f) => f.kind === "name_mismatch")).toBe(true);
  });
});

describe("what completes a person's documents", () => {
  const passportOnly: DocRead = { docId: "p", kind: "passport", side: "page", read: null };
  test("leasing's default set needs the visa with a passport", () => {
    const d = assessKyc(ctx([]), [passportOnly]);
    expect(d.flags.map((f) => f.kind)).toContain("missing_document");
  });
  test("any_id: a passport alone is a complete set", () => {
    const d = assessKyc(ctx([]), [passportOnly], { personDocs: "any_id" });
    expect(d.flags.map((f) => f.kind)).not.toContain("missing_document");
  });
  test("any_id: nothing at all is missing, with the profile's wording", () => {
    const d = assessKyc(ctx([]), [], { personDocs: "any_id" });
    expect(d.flags.find((f) => f.kind === "missing_document")?.message).toBe(
      "Needed: the passport, or both sides of the Emirates ID.",
    );
  });
});

describe("AI check wording comes from the profile", () => {
  test("the subject is in the system prompt", async () => {
    const llm = new FakeLlm(
      () => new Error("no decide"),
      undefined,
      () => ({ ok: true, reason: "" }),
    );
    await kycAiChecks(
      llm,
      [
        {
          id: "a1",
          label: "Employer",
          severity: "warning",
          emailApplicant: false,
          type: "ai_check",
          instruction: "Must have an employer stated",
        },
      ],
      {
        fullNameEn: null,
        nationality: null,
        birthDate: null,
        emiratesIdNo: null,
        idExpiresOn: null,
        passportNo: null,
        passportExpiresOn: null,
        visaNo: null,
        visaExpiresOn: null,
        companyName: null,
        tradeLicenceNo: null,
        tradeLicenceExpiresOn: null,
      },
      {},
      profile.aiCheckSubject,
    );
    expect(llm.chatCalls[0]![0]!.content).toContain("You check one rule an agency set for client documents.");
  });
  test("readPrompt for an extra key uses the profile's description", () => {
    expect(readPrompt("proof_of_address", undefined, profile)).toStartWith("This image should be a utility bill.");
  });
});
