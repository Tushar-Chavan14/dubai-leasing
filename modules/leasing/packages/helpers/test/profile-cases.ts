/**
 * Outputs of the shared helpers (KYC reader, contract-structure reader) on fixed fictional inputs, called the way
 * leasing calls them (no profile argument). `profile-default.test.ts` compares them with the golden file recorded
 * before profiles existed (S4, P1): the leasing default profile must give byte-identical prompts and results.
 * Regenerate only on purpose: `bun modules/leasing/packages/helpers/test/profile-cases.ts --write`.
 */
import { type CalendarDate, type FormField, makeTd3 } from "@leasing/core";
import { type ChatMessage, FakeLlm } from "@platform/llm";
import { generatePdf, SAMPLES } from "../src/contract-structure/evals/fixtures.ts";
import {
  contextParty,
  contractStructureHelper,
  type KycContext,
  kycHelper,
  mappingMessages,
  matchLabel,
  matchPlaceholder,
  partyIn,
  proposeMappings,
  readPrompt,
  type ReadKey,
  structureMessages,
  VisionRead,
} from "../src/index.ts";

const NONCE = "0123456789abcdef";
/** Prompts made inside a helper carry a random delimiter nonce; replace it so runs compare. */
const fixNonce = (s: string) => s.replace(/<<<DOC_[0-9a-f]+_(START|END)>>>/g, "<<<DOC_N_$1>>>");
const msgs = (m: ChatMessage[]) => m.map((x) => ({ role: x.role, content: fixNonce(x.content) }));

const hi = (value: string | null) => ({ value, confidence: 0.97 });
const [mrz1, mrz2] = makeTd3({
  issuingState: "IND",
  surname: "Example Rao",
  givenNames: "Priya",
  passportNo: "Z1234567",
  nationality: "IND",
  birthDate: "910307",
  sex: "F",
  expiresOn: "310101",
});
const READS: Record<ReadKey, Record<string, unknown>> = {
  emirates_id_front: {
    documentType: "identity_card_front",
    idNumber: hi("784-1991-4820193-4"),
    name: hi("Priya Example Rao"),
    nationality: hi("India"),
    birthDate: hi("07/03/1991"),
    sex: hi("F"),
    expiryDate: hi("14/08/2029"),
    issueDate: hi("14/08/2024"),
  },
  emirates_id_back: { documentType: "identity_card_back", cardNumber: hi("SPC4820193"), employer: hi("Fictional LLC") },
  passport: {
    documentType: "passport",
    passportNo: hi("Z1234567"),
    surname: hi("EXAMPLE RAO"),
    givenNames: hi("PRIYA"),
    nationality: hi("IND"),
    birthDate: hi("07/03/1991"),
    sex: hi("F"),
    expiryDate: hi("01/01/2031"),
    issueDate: hi("01/01/2021"),
    mrzLine1: hi(mrz1),
    mrzLine2: hi(mrz2),
  },
  visa: {
    documentType: "residence_visa",
    visaNo: hi("201/2024/1234567"),
    name: hi("Priya Example Rao"),
    passportNo: hi("Z1234567"),
    nationality: hi("India"),
    expiryDate: hi("01/06/2028"),
    issueDate: hi("01/06/2024"),
  },
  trade_licence: {
    documentType: "trade_licence",
    licenceNo: hi("CN-1234567"),
    tradeName: hi("Fictional Trading LLC"),
    managerName: hi("Priya Example Rao"),
    expiryDate: hi("01/06/2028"),
    issueDate: hi("01/06/2025"),
  },
  custom: {
    matchesDescription: "yes",
    holderName: hi("Priya Example Rao"),
    documentNumber: hi("SAL-77"),
    issueDate: hi("01/10/2026"),
    expiryDate: hi(null),
  },
};
const CUSTOM_FIELD: FormField = {
  key: "salary_certificate",
  label: "Salary certificate",
  placeholder: "",
  help: "",
  type: "document",
  required: false,
  appliesTo: "individual",
  options: [],
  documentKind: "custom",
  nameAsPerDocuments: false,
  customCategory: { name: "Salary certificate", description: "A letter from the employer", hasExpiry: false },
};

async function kycCases() {
  const keys = Object.keys(VisionRead) as ReadKey[];
  const prompts = Object.fromEntries([
    ...keys.filter((k) => k !== "custom").map((k) => [k, readPrompt(k)]),
    ["custom", readPrompt("custom", CUSTOM_FIELD.customCategory)],
    ["custom_no_description", readPrompt("custom", { name: "Bank letter", description: "", hasExpiry: true })],
  ]);
  const runs: Record<string, unknown> = {};
  const docs: Record<string, KycContext["documents"]> = {
    individual: [
      { docId: "f", kind: "emirates_id", side: "front" },
      { docId: "b", kind: "emirates_id", side: "back" },
      { docId: "p", kind: "passport", side: "page" },
      { docId: "v", kind: "visa", side: "page" },
      { docId: "c", kind: "custom", side: "page", fieldKey: "salary_certificate" },
    ],
    company: [{ docId: "t", kind: "trade_licence", side: "page" }],
  };
  for (const [name, documents] of Object.entries(docs)) {
    const keyOf = new Map(documents.map((d) => [d.docId, d]));
    const llm = new FakeLlm(
      () => new Error("no decide"),
      (images) => {
        const d = keyOf.get(new TextDecoder().decode(images[0]))!;
        const key: ReadKey =
          d.kind === "emirates_id"
            ? d.side === "back"
              ? "emirates_id_back"
              : "emirates_id_front"
            : (d.kind as ReadKey);
        return READS[key];
      },
    );
    const steps: unknown[] = [];
    const helper = kycHelper(llm, async (id) => new TextEncoder().encode(id), {
      onStep: (s) => {
        steps.push("ms" in s ? { ...s, ms: 0 } : s);
      },
    });
    const ctx: KycContext = {
      applicant: { nameEn: name === "company" ? "Fictional Trading LLC" : "Priya Example Rao", kind: name as never },
      leaseStartOn: "2027-01-01" as CalendarDate,
      today: "2026-11-01" as CalendarDate,
      minValidityDays: 30,
      minConfidence: 0.8,
      documents,
      form: [CUSTOM_FIELD],
    };
    const result = await helper.run({
      runId: "r",
      entity: { kind: "application", id: "a" },
      step: "kyc",
      context: ctx,
      rulesVersion: "dubai-2025-01",
      now: "2026-11-01T06:00:00Z",
    });
    runs[name] = { name: helper.name, prompts: llm.visionCalls.map((c) => c.prompt), steps, result };
  }
  return { prompts, runs };
}

/** The chat stand-in used for every sample: sections from the spec, labels from the nearby words. */
function fakeFor(sample: (typeof SAMPLES)[number]) {
  return new FakeLlm(
    () => new Error("no decide"),
    undefined,
    (messages: ChatMessage[]) => {
      const user = messages.find((m) => m.role === "user")!.content;
      if (messages[0]!.content.includes("You match blanks")) {
        const asked = user
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .map((l) => JSON.parse(l) as { id: string; before: string });
        return {
          blanks: asked.map((c) => ({
            id: c.id,
            key: sample.expect.maps.find((x) => c.before.slice(-30).includes(x.near))?.field ?? "none",
          })),
        };
      }
      const ctxs = user
        .split("BLANK CONTEXTS (JSON lines):\n")[1]!
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as { id: string; before: string });
      return {
        sections: sample.spec.sections.map((s) => ({ heading: s.heading })),
        blanks: ctxs.map((c) => {
          const m = sample.expect.maps.find((x) => c.before.slice(-30).includes(x.near));
          return { id: c.id, label: m?.near.replace(/:$/, "") ?? "Signature" };
        }),
      };
    },
  );
}

const LABELS = [
  "Landlord name",
  "Tenant nationality",
  "Owner's phone",
  "Lessee Emirates ID",
  "Lessor trade licence no",
  "Tenant passport expiry",
  "Nationality",
  "Phone",
  "Annual rent",
  "Security deposit",
  "Start date",
  "Makani number",
  "Unit no",
  "Building",
  "Community",
  "Number of cheques",
  "Cheque 2 date",
  "Landlord and tenant",
  "",
];
const PLACEHOLDERS = [
  "tenant name",
  "landlord_name",
  "unitNo",
  "Annual Rent",
  "community",
  "tenantNameEn",
  "lease ref",
  "unknown thing",
  "Owner Name",
  "lessee name",
  "registration fee",
  "additional terms",
];

async function templateCases() {
  const lines = [
    "TENANCY CONTRACT",
    "1. PARTIES",
    "Landlord name: {{b1}}",
    "Tenant name: {{b2}}",
    "2. RENT",
    "Annual rent: {{b3}}",
  ];
  const blanks = [
    { id: "b1", kind: "underscore" as const, marker: "____", line: 2, before: "Landlord name: ", after: "" },
    { id: "b2", kind: "underscore" as const, marker: "____", line: 3, before: "Tenant name: ", after: "" },
    { id: "b3", kind: "underscore" as const, marker: "____", line: 5, before: "Annual rent: ", after: "" },
  ];
  const items = blanks.map((b, i) => ({
    id: b.id,
    label: ["Landlord name", "Tenant name", "Annual rent"][i]!,
    before: b.before,
    after: b.after,
    party: ["landlord" as const, "tenant" as const, null][i]!,
  }));
  const partyTexts = [
    "The Landlord",
    "the tenants",
    "Owner and lessee",
    "LESSOR",
    "Lessee's address",
    "nobody here",
    "landlords and tenants",
  ];
  const ctxLines = [
    "Between the Landlord:",
    "Name: {{b1}}",
    "and the Tenant (lessee)",
    "Name: {{b2}}",
    "",
    "",
    "",
    "",
    "",
    "Rent {{b3}}",
  ];
  const unmatched = [
    { id: "u1", label: "Mystery field", before: "Mystery field: ", after: "", party: null },
    { id: "u2", label: "Landlord name", before: "Landlord name: ", after: "", party: "landlord" as const },
    {
      id: "u3",
      label: "Something",
      before: "Something ",
      after: "",
      party: "tenant" as const,
      placeholder: "tenant name",
    },
  ];
  const llm = new FakeLlm(
    () => new Error("no decide"),
    undefined,
    () => ({ blanks: [{ id: "u1", key: "community" }] }),
  );
  const proposed = await proposeMappings(llm, unmatched);
  const runs: Record<string, unknown> = {};
  for (const s of SAMPLES) {
    const bytes = await generatePdf(s.spec);
    const fake = fakeFor(s);
    const helper = contractStructureHelper(fake, { readFile: async () => bytes });
    const result = await helper.run({
      runId: "r1",
      entity: { kind: "company", id: "c1" },
      step: "extract_structure",
      context: { docId: "d1" },
      rulesVersion: "dubai-2025-01",
      now: "2026-10-28T00:00:00Z",
    });
    runs[s.spec.id] = { name: helper.name, chats: fake.chatCalls.map(msgs), result };
  }
  return {
    structureMessages: msgs(structureMessages(lines, blanks, NONCE)),
    mappingMessages: msgs(mappingMessages(items, NONCE)),
    partyIn: partyTexts.map((t) => [t, partyIn(t)]),
    contextParty: ctxLines.map((_, i) => contextParty(ctxLines, i)),
    matchLabel: LABELS.flatMap((l) => [null, "landlord", "tenant"].map((p) => [l, p, matchLabel(l, p as never)])),
    matchPlaceholder: PLACEHOLDERS.map((p) => [p, matchPlaceholder(p)]),
    proposeMappings: { ...proposed, proposals: [...proposed.proposals], chats: llm.chatCalls.map(msgs) },
    runs,
  };
}

export async function profileCases() {
  // Round-trip through JSON so `undefined` keys and Map/Set shapes compare as stored.
  return JSON.parse(JSON.stringify({ kyc: await kycCases(), template: await templateCases() })) as unknown;
}

export const GOLDEN = new URL("./fixtures/profile-default.golden.json", import.meta.url);

if (import.meta.main && process.argv.includes("--write")) {
  await Bun.write(GOLDEN, `${JSON.stringify(await profileCases(), null, 2)}\n`);
  console.log(`wrote ${GOLDEN.pathname}`);
}
