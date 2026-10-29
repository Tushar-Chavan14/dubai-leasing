import { appendSignatureRecord, renderPdf } from "@leasing/adapters";
import {
  type Actor,
  Addendum,
  compareNames,
  CONTRACT_CLAUSES,
  ContractSignature,
  newId,
  propertyUsageFor,
} from "@leasing/core";
import { sha256Hex, shortRef } from "@leasing/core/tokens";
import {
  actionLinks,
  applications,
  approvals,
  contracts,
  contractSigners,
  documents,
  inboundEvents,
  leaseEvents,
  leaseParties,
  leases,
  parties,
  tasks,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import {
  type ContractContext,
  ContractSchemas,
  contractDocument,
  contractHelper,
  remapForData,
  type Remapped,
  sheetExtras,
} from "@leasing/helpers";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, DomainError, notFound, unprocessable } from "../errors.ts";
import { advance } from "./advance.ts";
import { approvedClauses, resolveCompanyClauses } from "./clause-refs.ts";
import {
  approvedTemplateFor,
  parseTemplate,
  renderCompanyContract,
  templateKey,
  type TemplateRow,
} from "./company-templates.ts";
import { requestApproval } from "./approvals.ts";
import { companyLandlord, landlordGapMessage, landlordGaps, landlordSigner } from "./company-legal.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { sendTime } from "./agent-switches.ts";
import type { FinalContractProposal } from "./gate-rules.ts";
import { runAndRecord } from "./helpers.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import type { LinkRow } from "./links.ts";
import { createTask } from "./milestones.ts";
import { matchContractRule } from "./pricing.ts";

/**
 * Step 5 (architecture §3 Lease: CONTRACT). The Contract helper copies every field from its
 * record; an officer approves the whole contract (`final_contract`); each party signs through a
 * personal single-use link; when everyone has signed, the signed PDF gets a signature record page
 * and the Manager fires CONTRACT_SIGNED with the approval. Nothing here sends to Ejari.
 */
export const CONTRACT_PREPARE_JOB = "contract.prepare";
export const CONTRACT_FINISH_JOB = "contract.finish";

/** Clauses a contract starts with when the engine prepares it on its own (staff can re-issue). */
export const DEFAULT_ADDENDUM: Addendum = { clauses: ["maintenance", "no_subletting"], freeText: null };

type ContractRow = typeof contracts.$inferSelect;

/**
 * The addendum a contract starts with: the clauses of the unit's matching contract rule (standard
 * ones, and approved company clauses that are still approved), else the default clauses.
 */
export async function defaultAddendumFor(tx: Pick<Tx, "db">, leaseId: string): Promise<Addendum> {
  const [row] = await tx.db
    .select({ unit: units })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  const rule = row ? await matchContractRule(tx, row.unit) : null;
  if (!row || !rule || rule.clauseIds.length === 0) return DEFAULT_ADDENDUM;
  const approved = new Set((await approvedClauses(tx, row.unit.companyId)).map((c) => `cc:${c.id}`));
  const clauses = rule.clauseIds.filter(
    (c): c is Addendum["clauses"][number] => Object.hasOwn(CONTRACT_CLAUSES, c) || approved.has(c),
  );
  return { clauses, freeText: null };
}

/** The records a contract is copied from, as the helper receives them, and their hash. */
export async function contractInputs(tx: Tx, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId));
  if (!lease) throw notFound("lease");
  const people = await tx.db
    .select({ role: leaseParties.role, party: parties })
    .from(leaseParties)
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .where(eq(leaseParties.leaseId, leaseId));
  const tenant = people.find((p) => p.role === "tenant")?.party;
  if (!tenant) throw conflict("the lease needs a tenant on record", "no_parties");
  const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
  if (!unit) throw notFound("unit");
  // The landlord is the unit's company (D44): its legal party, never the party stored on the lease at creation.
  const { company, party: landlord } = await companyLandlord(tx, unit.companyId);
  const [app] = lease.applicationId
    ? await tx.db.select().from(applications).where(eq(applications.id, lease.applicationId))
    : [];
  const context: Omit<ContractContext, "addendum"> = {
    lease: {
      id: lease.id,
      ref: lease.ref,
      startOn: lease.startOn,
      endOn: lease.endOn,
      annualRentFils: lease.annualRentFils,
      cheques: lease.cheques,
      depositFils: lease.depositFils,
    },
    application: app
      ? {
          id: app.id,
          rentFreeDays: app.offer?.rentFreeDays ?? 0,
          moveInOn: app.offer?.moveInOn ?? lease.startOn,
          kycVerified: !!app.kycVerifiedAt,
        }
      : null,
    tenant: {
      id: tenant.id,
      kind: tenant.kind,
      fullNameEn: tenant.fullNameEn,
      nationality: tenant.nationality,
      emiratesIdNo: tenant.emiratesIdNo,
      idExpiresOn: tenant.idExpiresOn,
      passportNo: tenant.passportNo,
      passportExpiresOn: tenant.passportExpiresOn,
      visaNo: tenant.visaNo,
      tradeLicenceNo: tenant.tradeLicenceNo,
      tradeLicenceExpiresOn: tenant.tradeLicenceExpiresOn,
      email: tenant.email,
      phone: tenant.phone,
    },
    landlord: {
      id: landlord.id,
      kind: landlord.kind,
      fullNameEn: landlord.fullNameEn,
      emiratesIdNo: landlord.emiratesIdNo,
      tradeLicenceNo: landlord.tradeLicenceNo,
      email: landlord.email,
      nationality: landlord.nationality,
      phone: landlord.phone,
    },
    unit: {
      id: unit.id,
      kind: propertyUsageFor(unit.category),
      building: unit.building,
      community: unit.community,
      dldPropertyNo: unit.dldPropertyNo,
      unitNo: unit.unitNo,
      makaniNo: unit.makaniNo,
      plotNo: unit.plotNo,
      bedrooms: unit.bedrooms,
    },
  };
  // The unit's contract rule may pin an approved company template. Its id, version and content hash are part of
  // the hash, so a changed rule, template or version makes a pending `final_contract` approval stale. A rule whose
  // template is no longer usable (retired, other company) gives a different hash too, and `prepareContract` refuses it.
  const rule = await matchContractRule(tx, unit);
  let template: TemplateRow | null = null;
  let templateIssue: DomainError | null = null;
  if (rule?.templateId) {
    try {
      template = await approvedTemplateFor(tx, unit.companyId, rule.templateId);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      templateIssue = e;
    }
  }
  // Data-sheet values beyond the contract fields (unit, company, party and offer columns): copied verbatim.
  const extras = sheetExtras({ lease, unit, company, landlord, tenant, application: app });
  const hashed = template
    ? { ...context, template: templateKey(template), extras }
    : templateIssue && rule
      ? { ...context, template: { unavailable: rule.templateId } }
      : context;
  return {
    lease,
    tenant,
    landlord,
    company,
    unit,
    context,
    template,
    templateIssue,
    extras,
    inputHash: sha256Hex(JSON.stringify(hashed)),
  };
}

export type PrepareResult =
  | { status: "prepared"; contractId: string; version: number; approvalId: string }
  | { status: "needs_human"; reasons: string[]; helperRunId: string };

/**
 * Prepares a new contract version and asks for the `final_contract` approval. The helper (and the
 * addendum review's model call) runs before any lock is taken; the result is stored only if the
 * records it was copied from are still the same. An open version is superseded.
 */
export async function prepareContract(
  ctx: EngineContext,
  leaseId: string,
  input: { addendum: Addendum; actor: Actor; onlyIfNone?: boolean; reprepare?: boolean },
): Promise<PrepareResult | { status: "exists"; contractId: string }> {
  let addendum = Addendum.parse(input.addendum);
  if (input.onlyIfNone) {
    // The job prepares the first contract only; a re-run never supersedes a contract in progress.
    const [open] = await ctx.database.db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.leaseId, leaseId), inArray(contracts.status, ["pending_approval", "sent", "signed"])))
      .limit(1);
    if (open) return { status: "exists", contractId: open.id };
  }
  const pre = await withTx(ctx.database, async (tx) => {
    const i = await contractInputs(tx, leaseId);
    if (i.lease.state !== "CONTRACT") {
      throw conflict(
        `The lease is in ${i.lease.state}; contracts are prepared while it is in CONTRACT.`,
        "wrong_state",
      );
    }
    await refuseIfSigned(tx, leaseId);
    // `cc:` ids must be approved clauses of the unit's company; their approved wording is copied in
    // here by code (anything sent as `companyClauses` is dropped).
    if (i.templateIssue) throw i.templateIssue;
    // Blocks, with a message staff can act on, until the company's legal details and signatory are complete (D44).
    const gaps = landlordGaps(i.company, i.landlord, ctx.clock.today());
    if (gaps.length) {
      throw unprocessable(landlordGapMessage(i.company.name, gaps), gaps, "landlord_details_missing");
    }
    // Keep the lease's landlord row on the company's party (leases created before D44 pointed elsewhere).
    await tx.db
      .update(leaseParties)
      .set({ partyId: i.landlord.id })
      .where(and(eq(leaseParties.leaseId, leaseId), eq(leaseParties.role, "landlord")));
    const companyClauses = await resolveCompanyClauses(tx, i.unit.companyId, addendum.clauses);
    // Approved company clauses are immutable (decideClause only touches `proposed` rows), which is why the
    // inputHash (records the contract is copied from) does not include their text.
    addendum = { ...addendum, companyClauses };
    if (!companyClauses.length) delete addendum.companyClauses;
    const { run, helperRunId } = await runAndRecord(
      ctx,
      tx,
      contractHelper(ctx.llm),
      ContractSchemas,
      { kind: "lease", id: leaseId },
      "prepare",
      { ...i.context, addendum },
      i.lease.rulesVersion,
    );
    if (run.result.status !== "ok" || !run.result.data) {
      await createTask(ctx, tx, leaseId, {
        kind: "contract_needs_person",
        title: `Contract for ${i.lease.ref} can't be prepared: ${run.result.reasons.join(" ")}`,
        details: { helperRunId, reasons: run.result.reasons },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${leaseId}:contract_needs_person:${i.inputHash}:${sha256Hex(JSON.stringify(addendum))}`,
      });
      return { ok: false as const, reasons: run.result.reasons, helperRunId };
    }
    return {
      ok: true as const,
      data: run.result.data,
      helperRunId,
      inputHash: i.inputHash,
      template: i.template,
      extras: i.extras,
    };
  });
  if (!pre.ok) return { status: "needs_human", reasons: pre.reasons, helperRunId: pre.helperRunId };

  // Every preparation (the job after the offer, the copilot's confirmed proposal, "Prepare again"): the blank mapping
  // of the approved template is refreshed against the data held now (code rules, then the model on keys and
  // descriptions only). The template row is never edited; the mapping used is kept in the event payload. A model
  // that is down leaves the stored mapping in place.
  let remap: Remapped | null = null;
  if (pre.template) {
    const t = parseTemplate(pre.template);
    remap = await remapForData(ctx.contractAiLlm ?? ctx.llm, t.sections, t.blanks, {
      ...pre.extras,
      ...pre.data.fields,
    });
  }

  return withTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
    if (locked?.state !== "CONTRACT") throw conflict("The lease is no longer waiting for a contract.", "wrong_state");
    const i = await contractInputs(tx, leaseId);
    if (i.inputHash !== pre.inputHash) {
      throw conflict(
        "The lease, unit or party records changed while the contract was prepared. Prepare it again.",
        "stale",
      );
    }
    const [last] = await tx.db
      .select({ version: contracts.version })
      .from(contracts)
      .where(eq(contracts.leaseId, leaseId))
      .orderBy(desc(contracts.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    await refuseIfSigned(tx, leaseId);
    let supersededVersion: number | null = null;
    if (input.reprepare) {
      // Checked under the lease row lock: an approval or a send that landed first wins.
      const held = await tx.db
        .select({ c: contracts, approvalStatus: approvals.status })
        .from(contracts)
        .leftJoin(approvals, eq(approvals.id, contracts.approvalId))
        .where(eq(contracts.leaseId, leaseId))
        .for("update", { of: contracts });
      if (held.some((r) => r.c.status === "sent" || r.c.status === "signed" || r.approvalStatus === "approved")) {
        throw conflict(
          "The contract was already approved or sent to the signers, so it can't be prepared again.",
          "contract_already_approved",
        );
      }
      supersededVersion = held.find((r) => r.c.status === "pending_approval")?.c.version ?? null;
      if (supersededVersion === null) {
        throw conflict("There is no contract waiting for approval to prepare again.", "no_pending_contract");
      }
    }
    await supersedeOpenContracts(ctx, tx, leaseId, `replaced by version ${version}`, input.reprepare === true);

    const d = pre.data;
    const reference = shortRef("C");
    // In a company template when the unit's contract rule pins one (blanks filled from `d.fields` only; a value
    // that is missing fails here with a 422 before anything is stored); else the standard demo template.
    const subject = `${i.lease.ref} ${reference}`;
    let pdf: Uint8Array;
    let leftEmpty: string[] = [];
    let filled: { label: string; key: string }[] = [];
    if (i.template) {
      ({ pdf, leftEmpty, filled } = await renderCompanyContract(ctx, tx, i.template, {
        fields: d.fields,
        addendum: d.addendum,
        version,
        reference,
        subject,
        extras: i.extras,
        ...(remap ? { blanks: remap.blanks } : {}),
      }));
    } else {
      const doc = contractDocument(d.fields, d.addendum, {
        version,
        reference,
        preparedOn: ctx.clock.today(),
        demo: ctx.demoMode,
      });
      pdf = await renderPdf({ title: doc.title, subject }, doc.blocks);
    }
    const templateRef = i.template ? templateKey(i.template) : null;
    const stored = await ctx.documents.put(pdf, "pdf");
    const documentId = newId();
    await tx.db.insert(documents).values({
      id: documentId,
      partyId: i.tenant.id,
      leaseId,
      kind: "contract",
      sha256: stored.sha256,
      path: stored.path,
      mime: "application/pdf",
      extracted: { reference, version },
    });
    const contractId = newId();
    await tx.db.insert(contracts).values({
      id: contractId,
      leaseId,
      version,
      status: "pending_approval",
      fields: d.fields,
      sources: d.sources,
      addendum: d.addendum,
      flags: d.flags,
      inputHash: i.inputHash,
      helperRunId: pre.helperRunId,
      documentId,
      sha256: stored.sha256,
      createdBy: input.actor,
      createdAt: ctx.clock.now(),
    });
    const proposal: FinalContractProposal = {
      leaseId,
      leaseRef: i.lease.ref,
      contractId,
      version,
      reference,
      sha256: stored.sha256,
      inputHash: i.inputHash,
      fields: d.fields,
      sources: d.sources,
      addendum: d.addendum,
      flags: d.flags,
      reviewed: d.reviewed,
      ...(templateRef ? { template: templateRef } : {}),
    };
    const approval = await requestApproval(ctx, tx, {
      gate: "final_contract",
      entity: { kind: "lease", id: leaseId },
      dedupeKey: `${leaseId}:final_contract:v${version}`,
      title: `Final contract for ${i.lease.ref} (version ${version})`,
      proposal,
      reasons: [
        ...(templateRef ? [`Company template v${templateRef.version}`] : []),
        ...(remap?.changes.length
          ? [
              `Blank mapping refreshed for the data held now (blank: stored -> now): ${remap.changes
                .map((c) => `${c.label}: ${c.from} -> ${c.to} (${c.source})`)
                .join("; ")}`,
            ]
          : []),
        ...(remap?.modelUnavailable
          ? [
              "The mapping model was unavailable: the template's stored mapping was used for blanks it could not refresh.",
            ]
          : []),
        ...(filled.length
          ? [`Filled from the records (blank <- source): ${filled.map((f) => `${f.label} <- ${f.key}`).join("; ")}`]
          : []),
        ...(leftEmpty.length ? [`Left empty for hand-filling: ${leftEmpty.join(", ")}`] : []),
        ...(d.flags.length
          ? d.flags.map((f) => `Addendum ${f.kind.replace("_", " ")}: "${f.quote}" (${f.reason})`)
          : ["Every field is copied from its record. Check them against the sources and the PDF before approving."]),
      ],
      sources: [
        { kind: "document", documentId, label: `Contract PDF, version ${version}` },
        { kind: "helper_run", helperRunId: pre.helperRunId, label: "Contract helper run" },
      ],
      rulesVersion: i.lease.rulesVersion,
      proposedBy: input.actor,
    });
    await tx.db.update(contracts).set({ approvalId: approval.id }).where(eq(contracts.id, contractId));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "CONTRACT_PREPARED",
      actor: input.actor,
      payload: {
        contractId,
        version,
        reference,
        sha256: stored.sha256,
        helperRunId: pre.helperRunId,
        approvalId: approval.id,
        addendumFlags: d.flags.length,
        ...(templateRef
          ? { templateId: templateRef.id, templateVersion: templateRef.version, templateHash: templateRef.contentHash }
          : {}),
        ...(remap && i.template
          ? {
              mappingRefresh: {
                changes: remap.changes,
                modelUnavailable: remap.modelUnavailable,
                model: remap.model,
                mappingUsed: Object.fromEntries(
                  remap.blanks.filter((b) => b.role === "field").map((b) => [b.id, b.field]),
                ),
              },
            }
          : {}),
      },
      rulesVersion: i.lease.rulesVersion,
    });
    if (supersededVersion !== null) {
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: leaseId },
        type: "CONTRACT_REPREPARED",
        actor: input.actor,
        payload: { supersededVersion, newVersion: version, contractId, approvalId: approval.id },
        rulesVersion: i.lease.rulesVersion,
      });
    }
    // The officer task raised when automatic preparation is off is done now.
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.dedupeKey, `${leaseId}:prepare_contract`), eq(tasks.status, "open")));
    return { status: "prepared" as const, contractId, version, approvalId: approval.id };
  });
}

/**
 * "Prepare contract again" (staff). Allowed only while the open contract still waits for its `final_contract`
 * approval and nothing went to the signers. The pending approval is cancelled (CONTRACT_SUPERSEDED) and a new
 * contract is rendered from the current rule and template, with the same addendum, and a new `final_contract`
 * approval opens. Refused once a contract was approved, sent or signed. The gate is unchanged.
 */
export async function reprepareContract(ctx: EngineContext, leaseId: string, actor: Actor) {
  const [latest] = await ctx.database.db
    .select({ addendum: contracts.addendum })
    .from(contracts)
    .where(and(eq(contracts.leaseId, leaseId), eq(contracts.status, "pending_approval")))
    .orderBy(desc(contracts.version))
    .limit(1);
  if (!latest) {
    // Same answers as the locked check: an approved or sent contract refuses, otherwise nothing is pending.
    const [done] = await ctx.database.db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.leaseId, leaseId), inArray(contracts.status, ["sent", "signed"])))
      .limit(1);
    if (done) {
      throw conflict(
        "The contract was already approved or sent to the signers, so it can't be prepared again.",
        "contract_already_approved",
      );
    }
    throw conflict("There is no contract waiting for approval to prepare again.", "no_pending_contract");
  }
  const old = latest.addendum as Addendum;
  const addendum = Addendum.parse({ clauses: old.clauses, freeText: old.freeText ?? null });
  return prepareContract(ctx, leaseId, { addendum, actor, reprepare: true });
}

/**
 * Job path: a company template that can't be used (not approved any more, a blank with no value) is
 * not retried forever; an officer gets a task that says why. Returns true when the failure was reported.
 */
export async function reportTemplateFailure(ctx: EngineContext, leaseId: string, e: unknown): Promise<boolean> {
  if (!(e instanceof DomainError) || e.status !== 422 || !e.code.startsWith("template_")) return false;
  await withTx(ctx.database, async (tx) => {
    const [lease] = await tx.db.select({ ref: leases.ref }).from(leases).where(eq(leases.id, leaseId));
    await createTask(ctx, tx, leaseId, {
      kind: "contract_needs_person",
      title: `Contract for ${lease?.ref ?? leaseId} can't be prepared: ${e.message}`,
      details: { code: e.code, reasons: e.reasons },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${leaseId}:contract_needs_person:${e.code}:${sha256Hex(e.message)}`,
    });
  });
  return true;
}

/** A new version replaces the open one: its approval is cancelled and its signing links stop working. */
/** A signed contract is final: no path (job, staff, copilot confirm, re-prepare) may prepare or supersede past it. */
async function refuseIfSigned(tx: Tx, leaseId: string) {
  const [signed] = await tx.db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.leaseId, leaseId), eq(contracts.status, "signed")))
    .limit(1);
  if (signed) throw conflict("This contract is already signed, so it can't be prepared again.", "contract_signed");
}

async function supersedeOpenContracts(ctx: EngineContext, tx: Tx, leaseId: string, note: string, pendingOnly = false) {
  const open = await tx.db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.leaseId, leaseId),
        inArray(contracts.status, pendingOnly ? ["pending_approval"] : ["pending_approval", "sent"]),
      ),
    )
    .for("update");
  for (const c of open) {
    await tx.db.update(contracts).set({ status: "superseded" }).where(eq(contracts.id, c.id));
    if (c.approvalId) {
      await tx.db
        .update(approvals)
        .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: note })
        .where(and(eq(approvals.id, c.approvalId), eq(approvals.status, "pending")));
    }
    await expireSignerLinks(ctx, tx, c.id);
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "CONTRACT_SUPERSEDED",
      actor: "system",
      payload: { contractId: c.id, version: c.version, note },
    });
  }
}

async function expireSignerLinks(ctx: EngineContext, tx: Tx, contractId: string) {
  const signers = await tx.db.select().from(contractSigners).where(eq(contractSigners.contractId, contractId));
  const ids = signers.map((s) => s.linkId).filter((x): x is string => !!x);
  if (ids.length) {
    await tx.db
      .update(actionLinks)
      .set({ expiresAt: ctx.clock.now() })
      .where(and(inArray(actionLinks.id, ids), isNull(actionLinks.usedAt)));
  }
}

/**
 * The officer decided a `final_contract` approval. Approved: the records and the stored PDF must
 * be exactly what was approved, then each party gets a signing link. The approval is consumed
 * only by CONTRACT_SIGNED, once everyone has signed.
 */
export async function onContractDecided(
  ctx: EngineContext,
  tx: Tx,
  a: typeof approvals.$inferSelect,
  status: "approved" | "edited" | "rejected",
) {
  const [c] = await tx.db.select().from(contracts).where(eq(contracts.approvalId, a.id)).for("update");
  if (!c) throw conflict("There is no contract for this approval.", "stale");
  if (status === "rejected") {
    if (c.status === "pending_approval") {
      await tx.db.update(contracts).set({ status: "rejected" }).where(eq(contracts.id, c.id));
    }
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: c.leaseId },
      type: "CONTRACT_REJECTED",
      actor: a.decidedBy ? `user:${a.decidedBy}` : "system",
      payload: { contractId: c.id, version: c.version, note: a.decisionNote },
    });
    return;
  }
  if (c.status !== "pending_approval") throw conflict(`Contract version ${c.version} is ${c.status}.`, "stale");
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, c.leaseId)).for("update");
  if (lease?.state !== "CONTRACT") throw conflict("The lease is no longer waiting for a contract.", "stale");
  const i = await contractInputs(tx, c.leaseId);
  if (i.inputHash !== c.inputHash) {
    throw unprocessable(
      "The lease, unit or party records changed after this contract was prepared. Prepare a new version.",
      [],
      "stale",
    );
  }
  const pdf = await contractPdf(ctx, tx, c, "approved");
  if (sha256Hex(pdf) !== c.sha256) {
    throw unprocessable("The contract PDF on file is not the one that was prepared.", [], "stale");
  }
  await tx.db.update(contracts).set({ status: "sent", sentAt: ctx.clock.now() }).where(eq(contracts.id, c.id));
  const landlordSign = landlordSigner(i.company, i.landlord);
  if (!landlordSign) throw unprocessable("The company has no authorised signatory.", [], "landlord_details_missing");
  for (const [role, party, nameEn] of [
    ["tenant", i.tenant, c.fields.tenantNameEn],
    // The authorised signatory signs for the company (D44) and types their own name.
    ["landlord", i.landlord, landlordSign.name],
  ] as const) {
    const signerId = newId();
    await tx.db.insert(contractSigners).values({
      id: signerId,
      contractId: c.id,
      partyId: party.id,
      role,
      nameEn,
      capacity: role === "landlord" ? landlordSign.capacity : null,
      email: role === "landlord" ? landlordSign.email : party.email,
      createdAt: ctx.clock.now(),
    });
    await queueLeaseMail(ctx, tx, { leaseId: c.leaseId, kind: "sign", key: signerId, seq: 1 });
    // `sign_reminder` (D37): N days later, if this signer still hasn't signed (the sender re-checks).
    const a = (await getCompanyPolicy(tx, ctx.clock.today())).autopilot;
    if (a.sign_reminder) {
      await queueLeaseMail(
        ctx,
        tx,
        { leaseId: c.leaseId, kind: "sign_reminder", key: signerId, seq: 1 },
        sendTime(a, new Date(ctx.clock.now().getTime() + a.sign_reminder_days * 86_400_000)),
      );
    }
  }
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: c.leaseId },
    type: "CONTRACT_SENT",
    actor: "system",
    payload: { contractId: c.id, version: c.version, approvalId: a.id, signers: ["tenant", "landlord"] },
    rulesVersion: lease.rulesVersion,
  });
}

/** The stored PDF of a contract version (`signed` once everyone signed). */
export async function contractPdf(ctx: EngineContext, tx: Tx, c: ContractRow, which: "approved" | "signed") {
  const id = which === "signed" ? c.signedDocumentId : c.documentId;
  if (!id) throw notFound("contract document");
  const [doc] = await tx.db.select().from(documents).where(eq(documents.id, id));
  if (!doc) throw notFound("contract document");
  return new Uint8Array(await ctx.documents.read(doc.path));
}

/** Re-sends a signing link (a new one; the old one stops working). Staff action. */
export async function resendSignLink(
  ctx: EngineContext,
  leaseId: string,
  signerId: string,
  actor: Actor,
  /** Web chat status check: at most one re-send per signer per Dubai day. */
  opts: { oncePerDay?: boolean } = {},
  inTx?: Tx,
) {
  const run = async (tx: Tx) => {
    const [s] = await tx.db
      .select({ signer: contractSigners, contract: contracts })
      .from(contractSigners)
      .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
      .where(and(eq(contractSigners.id, signerId), eq(contracts.leaseId, leaseId)))
      .for("update");
    if (!s) throw notFound("signer");
    if (s.contract.status !== "sent" || s.signer.signedAt) throw conflict("This signer has nothing left to sign.");
    const today = ctx.clock.today();
    if (opts.oncePerDay) {
      const prior = await tx.db
        .select({ payload: leaseEvents.payload })
        .from(leaseEvents)
        .where(and(eq(leaseEvents.entityId, leaseId), eq(leaseEvents.type, "SIGN_LINK_RESENT")));
      if (
        prior.some(
          (e) =>
            (e.payload as { signerId?: string; on?: string }).signerId === signerId &&
            (e.payload as { on?: string }).on === today,
        )
      )
        return { queued: false, seq: 0, duplicate: true };
    }
    const seq = await nextSignSeq(tx, leaseId, signerId);
    await queueLeaseMail(ctx, tx, { leaseId, kind: "sign", key: signerId, seq });
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "SIGN_LINK_RESENT",
      actor,
      payload: { contractId: s.contract.id, signerId, role: s.signer.role, seq, on: today },
    });
    return { queued: true, seq, duplicate: false };
  };
  return inTx ? run(inTx) : withTx(ctx.database, run);
}

async function nextSignSeq(tx: Tx, leaseId: string, signerId: string): Promise<number> {
  const rows = await tx.db
    .select({ payload: leaseEvents.payload })
    .from(leaseEvents)
    .where(and(eq(leaseEvents.entityId, leaseId), eq(leaseEvents.type, "SIGN_LINK_RESENT")));
  return 2 + rows.filter((r) => (r.payload as { signerId?: string }).signerId === signerId).length;
}

/** What a signer sees in the portal (their own contract; ID numbers masked by the API). */
export async function signView(tx: Tx, link: LinkRow) {
  const [s] = await tx.db
    .select({ signer: contractSigners, contract: contracts })
    .from(contractSigners)
    .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
    .where(eq(contractSigners.linkId, link.id));
  if (!s) return null;
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, s.contract.leaseId));
  const f = s.contract.fields;
  return {
    kind: "sign" as const,
    purpose: link.purpose,
    linkUsed: !!link.usedAt,
    role: s.signer.role,
    signerName: s.signer.nameEn,
    signerCapacity: s.signer.capacity,
    signedAt: s.signer.signedAt,
    contract: {
      version: s.contract.version,
      status: s.contract.status,
      sha256: s.contract.sha256,
      fields: f,
      addendum: s.contract.addendum,
    },
    leaseRef: lease?.ref ?? f.leaseRef,
    canSign: !link.usedAt && !s.signer.signedAt && s.contract.status === "sent" && lease?.state === "CONTRACT",
  };
}

/**
 * A signer signs in the portal: the typed name must be their name on the contract (case and
 * spacing aside). The signature is stored at once as evidence; when the last signer signs, the
 * finishing job builds the signed copy and advances the lease.
 */
export async function signContract(
  ctx: EngineContext,
  link: LinkRow | null,
  body: unknown,
  meta: { ip: string | null; userAgent: string | null },
) {
  const sig = ContractSignature.safeParse(body);
  if (!sig.success) {
    throw unprocessable(
      "Type your full name and tick the box to sign.",
      sig.error.issues.map((i) => i.message),
      "invalid_payload",
    );
  }
  return withTx(ctx.database, async (tx) => {
    if (!link || link.purpose !== "sign") throw conflict("Open the signing link from your email.");
    const [s] = await tx.db
      .select({ signer: contractSigners, contract: contracts })
      .from(contractSigners)
      .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
      .where(eq(contractSigners.linkId, link.id))
      .for("update");
    if (!s) throw conflict("This signing link is no longer valid. Use the newest email from us.");
    if (s.signer.signedAt) throw conflict("You have already signed this contract.");
    if (link.usedAt) throw conflict("This link was already used.");
    if (s.contract.status !== "sent")
      throw conflict("This contract version has been replaced. Use the newest email from us.");
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, s.contract.leaseId)).for("update");
    if (lease?.state !== "CONTRACT") throw conflict("This contract can no longer be signed.");
    const match = compareNames(sig.data.typedName, s.signer.nameEn);
    const extra = /\d/.test(sig.data.typedName) && !/\d/.test(s.signer.nameEn);
    if (extra || (match !== "exact" && match !== "typo_class")) {
      throw unprocessable(
        `Type your full name exactly as it is written on the contract: ${s.signer.nameEn}.`,
        [],
        "name_mismatch",
      );
    }
    const now = ctx.clock.now();
    const inboundId = newId();
    const ref = shortRef("S");
    await tx.db.insert(inboundEvents).values({
      id: inboundId,
      ref,
      type: "CONTRACT_SIGNED_BY",
      entityKind: "lease",
      entityId: lease.id,
      channel: "portal",
      actor: `${s.signer.role}:${s.signer.partyId}`,
      linkId: link.id,
      dedupeKey: `sign:${s.signer.id}`,
      payload: {
        contractId: s.contract.id,
        version: s.contract.version,
        role: s.signer.role,
        typedName: sig.data.typedName,
        consent: true,
        documentSha256: s.contract.sha256,
      },
      status: "applied",
      receivedAt: now,
      processedAt: now,
    });
    await tx.db.update(actionLinks).set({ usedAt: now }).where(eq(actionLinks.id, link.id));
    await tx.db
      .update(contractSigners)
      .set({
        signedAt: now,
        typedName: sig.data.typedName,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        inboundEventId: inboundId,
      })
      .where(eq(contractSigners.id, s.signer.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "CONTRACT_SIGNED_BY",
      actor: `${s.signer.role}:${s.signer.partyId}`,
      payload: {
        contractId: s.contract.id,
        version: s.contract.version,
        role: s.signer.role,
        inboundEventId: inboundId,
        ref,
      },
      rulesVersion: lease.rulesVersion,
    });
    const pending = await tx.db
      .select({ id: contractSigners.id })
      .from(contractSigners)
      .where(and(eq(contractSigners.contractId, s.contract.id), isNull(contractSigners.signedAt)));
    if (pending.length === 0) {
      await ctx.scheduler.send(tx, {
        name: CONTRACT_FINISH_JOB,
        data: { contractId: s.contract.id },
        singletonKey: `${lease.id}:contract-finish:${s.contract.id}`,
      });
    }
    return { ref, allSigned: pending.length === 0 };
  });
}

/**
 * Everyone signed (job): append the signature record page to the approved PDF, store the signed
 * copy with its hash, and fire CONTRACT_SIGNED with the `final_contract` approval. Safe to run twice.
 */
export async function finishContract(ctx: EngineContext, contractId: string) {
  return withTx(ctx.database, async (tx) => {
    const [c] = await tx.db.select().from(contracts).where(eq(contracts.id, contractId)).for("update");
    if (!c) throw notFound("contract");
    if (c.status === "signed") return { finished: false, reason: "already signed" };
    if (c.status !== "sent") return { finished: false, reason: `contract is ${c.status}` };
    const signers = await tx.db.select().from(contractSigners).where(eq(contractSigners.contractId, c.id));
    if (signers.length < 2 || signers.some((s) => !s.signedAt))
      return { finished: false, reason: "not everyone has signed" };
    const original = await contractPdf(ctx, tx, c, "approved");
    if (sha256Hex(original) !== c.sha256) throw new Error("the approved contract PDF on file has changed");
    const signedPdf = await appendSignatureRecord(original, {
      reference: `${c.fields.leaseRef} v${c.version}`,
      documentSha256: c.sha256,
      signers: signers
        .toSorted((a, b) => (a.role === "tenant" ? -1 : b.role === "tenant" ? 1 : 0))
        .map((s) => ({
          role: s.role,
          name: s.nameEn,
          capacity: s.capacity,
          typedName: s.typedName ?? "",
          signedAt: s.signedAt!.toISOString(),
          email: s.email,
        })),
      demo: ctx.demoMode,
    });
    const stored = await ctx.documents.put(signedPdf, "pdf");
    const signedDocumentId = newId();
    const tenant = signers.find((s) => s.role === "tenant");
    await tx.db.insert(documents).values({
      id: signedDocumentId,
      partyId: tenant?.partyId ?? null,
      leaseId: c.leaseId,
      kind: "contract_signed",
      sha256: stored.sha256,
      path: stored.path,
      mime: "application/pdf",
      extracted: { contractId: c.id, version: c.version, approvedSha256: c.sha256 },
    });
    await tx.db
      .update(contracts)
      .set({ status: "signed", signedAt: ctx.clock.now(), signedDocumentId, signedSha256: stored.sha256 })
      .where(eq(contracts.id, c.id));
    await advance(ctx, { kind: "lease", id: c.leaseId }, "CONTRACT_SIGNED", {
      actor: "system",
      ...(c.approvalId ? { approvalId: c.approvalId } : {}),
      payload: { contractId: c.id, version: c.version, signedSha256: stored.sha256 },
      tx,
    });
    for (const s of signers) await queueLeaseMail(ctx, tx, { leaseId: c.leaseId, kind: "signed", key: s.id, seq: 1 });
    return { finished: true, signedSha256: stored.sha256 };
  });
}

/** CONTRACT_SIGNED applies only to a fully signed contract of exactly this approval (checked in `advance`). */
export async function assertSignedContract(
  tx: Tx,
  leaseId: string,
  approvalId: string,
  payload: Record<string, unknown>,
) {
  const contractId = typeof payload.contractId === "string" ? payload.contractId : null;
  const [c] = contractId ? await tx.db.select().from(contracts).where(eq(contracts.id, contractId)) : [];
  const reasons: string[] = [];
  if (!c || c.leaseId !== leaseId) reasons.push("no contract of this lease was named");
  else {
    if (c.approvalId !== approvalId) reasons.push("the approval is for another contract version");
    if (c.status !== "signed" || !c.signedSha256) reasons.push("the contract is not signed by everyone");
  }
  if (reasons.length) throw conflict(`CONTRACT_SIGNED refused: ${reasons.join("; ")}`, "gate_required");
}

/** The signed contract a registration is built from. */
export async function signedContract(tx: Tx, leaseId: string): Promise<ContractRow | null> {
  const [c] = await tx.db
    .select()
    .from(contracts)
    .where(and(eq(contracts.leaseId, leaseId), eq(contracts.status, "signed")))
    .orderBy(desc(contracts.version))
    .limit(1);
  return c ?? null;
}
