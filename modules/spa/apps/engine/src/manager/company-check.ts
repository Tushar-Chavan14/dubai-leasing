import { newId } from "@platform/kernel/ids";
import { maskPii, maskPiiText } from "@platform/kernel/pii";
import type { SpaActor } from "@spa/core";
import {
  beneficialOwners,
  companyChecks,
  type CompanyCheckStatus,
  deals,
  helperRuns,
  parties,
  signatories,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import {
  companyChecks as runCompanyRules,
  type Finding,
  interpretAuthority,
  interpretLicence,
  interpretMoa,
  normaliseName,
  READER_PROMPT_VERSION,
  type ReadFields,
} from "@spa/helpers";
import { getSalesRulebook } from "@spa/rulebook";
import { eq, sum } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { COMPANY_CHECK_JOB } from "../jobs.ts";
import { driveAfter } from "./drive.ts";
import { afterHelperResult, requireHelperOn } from "./helper-modes.ts";
import { proposeApproval } from "./approvals.ts";
import { companyChecksOkFact, currentCompanyDocuments, latestCompanyCheck } from "./company-facts.ts";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { dealKycParties, docsHashOf } from "./kyc-facts.ts";
import { addBeneficialOwner } from "./parties.ts";
import { policyAt } from "./policy.ts";
import { ensureRead, needSales, type ReaderDeps } from "./readers.ts";

export { COMPANY_CHECK_JOB, companyChecksOkFact };
export const companyCheckJobKey = (partyId: string, docsHash: string) => `${partyId}:company:${docsHash}`;

/**
 * Findings that say something about the ownership structure (an owner may be hidden or missing). They are AML signals
 * (S50): they stay in `company_checks` (compliance read), never in an event, a staff-visible helper run or a staff
 * approval (review 10, tipping-off). Staff see the other findings, which are about documents they can fix.
 */
export const OWNERSHIP_SIGNAL_CODES: ReadonlySet<string> = new Set([
  "corporate_shareholder",
  "shares_under_100",
  "shares_over_100",
  "owner_not_added",
  "no_shareholders",
]);
const staffFindings = (findings: readonly Finding[]) => findings.filter((f) => !OWNERSHIP_SIGNAL_CODES.has(f.code));
const GENERIC_REVIEW = "This company needs a person's review.";

const CHECKER: SpaActor = "system:company-check";
const CLOSED = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);
type Person = { id: string; role: Parameters<typeof needSales>[0]["role"] };

async function companyOnDeal(ctx: SpaContext, dealId: string, partyId: string) {
  const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  const p = (await dealKycParties(ctx.database.db, dealId)).find((x) => x.partyId === partyId);
  if (!p) throw unprocessable("party_not_on_deal", "that party isn't on this deal");
  if (p.role !== "company_party") throw unprocessable("not_a_company", "only a company is checked this way");
  return { deal: d, party: p };
}

export interface CompanyCheckResult {
  checkId: string;
  status: CompanyCheckStatus;
  /** False when the same documents had already been checked. */
  created: boolean;
}

/** Queues a company check: one job per party and set of documents (rule 7). Safe to send twice. */
export async function enqueueCompanyCheck(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  input: { dealId: string; partyId: string },
  user?: Person,
): Promise<{ key: string; jobId: string | null; queued: boolean }> {
  if (user) needSales(user, "start a company check");
  await companyOnDeal(ctx, input.dealId, input.partyId);
  await requireHelperOn(ctx, "spa_company_check", "*", input.dealId);
  const docs = await currentCompanyDocuments(ctx.database.db, input.dealId, input.partyId);
  const key = companyCheckJobKey(input.partyId, docsHashOf(docs));
  const jobId = await boss.send(COMPANY_CHECK_JOB, input, { singletonKey: key });
  return { key, jobId, queued: jobId !== null };
}

/**
 * Checks one company buyer or seller (S14, S52). The reader copies the trade licence, the memorandum and the POA or
 * board resolution; code decides: the licence is valid and long enough, a named signer holds a power over property,
 * and which shareholders hold at least the rulebook's `beneficialOwnerBps`. Those owners are recorded as
 * `beneficial_owner` parties (C4) only on clear readings that add to at most 100%. Anything unread, missing or
 * unresolved is `review` (`seller_verification`) and counts an ownership layer for the AML rule: it never concludes
 * "no other owners" by default. The same documents are never checked twice.
 */
export async function runCompanyCheck(
  ctx: SpaContext,
  deps: ReaderDeps,
  input: { dealId: string; partyId: string },
  actor: SpaActor = CHECKER,
): Promise<CompanyCheckResult> {
  const r = await runCompanyCheckOnce(ctx, deps, input, actor);
  await driveAfter(ctx, input.dealId);
  return r;
}

async function runCompanyCheckOnce(
  ctx: SpaContext,
  deps: ReaderDeps,
  input: { dealId: string; partyId: string },
  actor: SpaActor = CHECKER,
): Promise<CompanyCheckResult> {
  const { dealId, partyId } = input;
  const { deal, party } = await companyOnDeal(ctx, dealId, partyId);
  if (CLOSED.has(deal.state)) throw conflict("deal_closed", `a deal in ${deal.state} needs no more checks`);
  await requireHelperOn(ctx, "spa_company_check", "*", dealId);
  const db = ctx.database.db;
  const docs = await currentCompanyDocuments(db, dealId, partyId);
  const docsHash = docsHashOf(docs);
  const same = (c: Awaited<ReturnType<typeof latestCompanyCheck>>) =>
    c && c.docsHash === docsHash && c.status !== "needs_human";
  const before = await latestCompanyCheck(db, dealId, partyId);
  if (before && same(before)) return { checkId: before.id, status: before.status, created: false };

  // Read every document (no transaction is open while the model works).
  const readRows: { kind: string; fields: ReadFields; instructionFound: boolean; modelTag: string | null }[] = [];
  let failure: string[] | null = null;
  for (const d of docs) {
    const r = await ensureRead(ctx, deps, d);
    if (!r.ok) {
      failure = r.reasons;
      break;
    }
    readRows.push({
      kind: d.kind,
      fields: r.row.fields as ReadFields,
      instructionFound: r.row.instructionFound,
      modelTag: r.row.modelTag,
    });
  }
  const rb = (ctx.rulebook ?? getSalesRulebook)(deal.rulesVersion);
  if (!rb) throw conflict("no_rulebook", `the rulebook ${deal.rulesVersion} isn't available`);
  const recorded = await db
    .select({ name: parties.fullNameEn, authority: signatories.authority })
    .from(signatories)
    .innerJoin(parties, eq(parties.id, signatories.personPartyId))
    .where(eq(signatories.companyPartyId, partyId));
  const kinds = (k: string) => readRows.filter((r) => r.kind === k);
  const licence = kinds("trade_licence")[0];
  const moa = kinds("memorandum")[0];
  const result = failure
    ? null
    : runCompanyRules({
        today: ctx.clock.today(),
        minLicenceDays: (await policyAt(db, deal.policyVersion)).companyLicenceMinDays,
        targetTransferOn: deal.targetTransferOn,
        ownerThresholdBps: rb.beneficialOwnerBps,
        partyName: party.name,
        licence: licence ? interpretLicence(licence.fields) : null,
        moa: moa ? interpretMoa(moa.fields) : null,
        authorities: [
          ...kinds("poa").map((r) => interpretAuthority("poa", r.fields)),
          ...kinds("board_resolution").map((r) => interpretAuthority("board_resolution", r.fields)),
        ],
        signatories: recorded,
        instructionFound: readRows.some((r) => r.instructionFound),
      });

  return withSpaTx(ctx.database, async (tx): Promise<CompanyCheckResult> => {
    const [locked] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!locked) throw notFound("deal");
    if (CLOSED.has(locked.state)) throw conflict("deal_closed", `a deal in ${locked.state} needs no more checks`);
    // Another worker may have recorded the same check while the model was working.
    const now = await latestCompanyCheck(tx.db, dealId, partyId);
    if (now && same(now)) return { checkId: now.id, status: now.status, created: false };

    const findings: Finding[] = result
      ? [...result.findings]
      : [
          {
            code: "read_failed",
            message: "A document couldn't be read. A person needs to check the company.",
            severity: "review",
          },
        ];
    const owners: { name: string; bps: number; added: boolean }[] = [];
    if (result) {
      const mine = await tx.db
        .select({ id: parties.id, name: parties.fullNameEn, bps: beneficialOwners.shareBps })
        .from(beneficialOwners)
        .innerJoin(parties, eq(parties.id, beneficialOwners.personPartyId))
        .where(eq(beneficialOwners.companyPartyId, partyId));
      const toAdd = new Set(result.ownersToAdd.map((o) => normaliseName(o.name)));
      for (const o of result.owners) {
        if (!toAdd.has(normaliseName(o.name))) {
          // Corporate holders and holders on unclear readings are listed but never recorded as people.
          owners.push({ name: o.name, bps: o.bps, added: false });
          continue;
        }
        if (mine.some((m) => normaliseName(m.name) === normaliseName(o.name))) {
          owners.push({ name: o.name, bps: o.bps, added: true });
          continue;
        }
        const [{ total } = { total: "0" }] = await tx.db
          .select({ total: sum(beneficialOwners.shareBps) })
          .from(beneficialOwners)
          .where(eq(beneficialOwners.companyPartyId, partyId));
        if (Number(total ?? 0) + o.bps > 10_000) {
          findings.push({
            code: "owner_not_added",
            message: "Recording this owner would take the company's owners over 100%: a person must reconcile them.",
            severity: "review",
          });
          owners.push({ name: o.name, bps: o.bps, added: false });
          continue;
        }
        await addOwner(ctx, tx, partyId, o, actor);
        owners.push({ name: o.name, bps: o.bps, added: true });
      }
    }
    const status: CompanyCheckStatus = !result
      ? "needs_human"
      : findings.some((f) => f.severity === "review")
        ? "review"
        : "passed";
    // Staff see only the findings about documents; an ownership-structure signal leaves a generic line instead.
    const staffReview = staffFindings(findings).filter((f) => f.severity === "review");
    const hiddenReview = findings.some((f) => f.severity === "review" && OWNERSHIP_SIGNAL_CODES.has(f.code));
    const reviewMessages = [...staffReview.map((f) => f.message), ...(hiddenReview ? [GENERIC_REVIEW] : [])];
    const runId = newId();
    await tx.db.insert(helperRuns).values({
      id: runId,
      helper: "spa_company_check",
      dealId,
      entityKind: "party",
      entityId: partyId,
      status: result ? "ok" : "needs_human",
      result: maskPii({ status, findings: staffFindings(findings).map((f) => f.code) }),
      reasons: maskPii(failure ?? reviewMessages),
      modelTag: licence?.modelTag ?? moa?.modelTag ?? deps.llm.visionModelName ?? null,
      promptVersion: READER_PROMPT_VERSION,
      rulesVersion: deal.rulesVersion,
      visibility: "staff",
      createdAt: ctx.clock.now(),
    });
    const checkId = newId();
    await tx.db.insert(companyChecks).values({
      id: checkId,
      dealId,
      partyId,
      status,
      licenceExpiresOn: result?.licenceExpiresOn ?? null,
      signerOk: result?.signerOk ?? false,
      owners,
      layers: result?.layers ?? 0,
      findings,
      docsHash,
      runId,
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "COMPANY_CHECK_RUN",
      actor,
      rulesVersion: deal.rulesVersion,
      payload: { partyId, checkId, status, findings: staffFindings(findings).map((f) => f.code) },
    });
    // Review mode (S59): a pass waits for a person's "looks right" before it counts.
    if (status === "passed")
      await afterHelperResult(ctx, tx, { helper: "spa_company_check", scope: "*", dealId, runId, status: "ok" });
    if (status === "review")
      await proposeApproval(
        ctx,
        {
          gate: "seller_verification",
          entity: { kind: "deal", id: dealId },
          dedupeKey: `${checkId}:seller_verification`,
          title: `Company check: ${party.name}`,
          proposal: {
            partyId,
            companyCheckId: checkId,
            codes: staffReview.map((f) => f.code),
          },
          reasons: reviewMessages,
          proposedBy: actor,
        },
        tx,
      );
    return { checkId, status, created: true };
  });
}

/** A beneficial owner from a licence-clear reading: a person party named as read, then recorded through C4. */
async function addOwner(
  ctx: SpaContext,
  tx: SpaTx,
  companyPartyId: string,
  owner: { name: string; bps: number },
  actor: SpaActor,
): Promise<void> {
  const personPartyId = newId();
  // Only the name is known. The address is a reserved `.invalid` placeholder: staff add real contact details when
  // they ask this person for documents (they are a KYC subject like any owner, S49).
  await tx.db.insert(parties).values({
    id: personPartyId,
    kind: "person",
    fullNameEn: owner.name,
    email: `owner-${personPartyId}@pending.invalid`,
    createdAt: ctx.clock.now(),
  });
  await appendDealEvent(tx, ctx, {
    entity: { kind: "party", id: personPartyId },
    type: "PARTY_CREATED",
    actor,
    payload: { kind: "person", source: "company-check" },
  });
  await addBeneficialOwner(ctx, { companyPartyId, personPartyId, shareBps: owner.bps }, actor, { tx });
}

/** Each company buyer or seller's latest check, with its findings (staff view; no ID numbers). */
export async function listCompanyChecks(ctx: SpaContext, dealId: string, user: Person) {
  needSales(user, "see company checks");
  const db = ctx.database.db;
  const [d] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  const out = [];
  for (const p of (await dealKycParties(db, dealId)).filter((x) => x.role === "company_party")) {
    const c = await latestCompanyCheck(db, dealId, p.partyId);
    out.push({
      partyId: p.partyId,
      name: p.name,
      checkId: c?.id ?? null,
      status: c?.status ?? null,
      signerOk: c?.signerOk ?? null,
      licenceExpiresOn: c?.licenceExpiresOn ?? null,
      // The ownership layer count, the owners and the ownership-structure findings are compliance's (review 10).
      findings: staffFindings((c?.findings ?? []) as Finding[]).map((f) => ({ ...f, message: maskPiiText(f.message) })),
      checkedAt: c?.createdAt ?? null,
    });
  }
  return { companies: out };
}
