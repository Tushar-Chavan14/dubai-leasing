import { appendSignatureRecord, renderPdf } from "@leasing/adapters";
import { type Actor, Addendum, compareNames, ContractSignature, newId } from "@leasing/core";
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
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { type ContractContext, ContractSchemas, contractDocument, contractHelper } from "@leasing/helpers";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { advance } from "./advance.ts";
import { requestApproval } from "./approvals.ts";
import { appendEvent } from "./events.ts";
import type { FinalContractProposal } from "./gate-rules.ts";
import { runAndRecord } from "./helpers.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import type { LinkRow } from "./links.ts";
import { createTask } from "./milestones.ts";

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
  const landlord = people.find((p) => p.role === "landlord")?.party;
  if (!tenant || !landlord) throw conflict("the lease needs a tenant and a landlord on record", "no_parties");
  const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
  if (!unit) throw notFound("unit");
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
    },
    unit: {
      id: unit.id,
      kind: unit.kind,
      building: unit.building,
      community: unit.community,
      dldPropertyNo: unit.dldPropertyNo,
      unitNo: unit.unitNo,
      makaniNo: unit.makaniNo,
      plotNo: unit.plotNo,
      bedrooms: unit.bedrooms,
    },
  };
  return { lease, tenant, landlord, unit, context, inputHash: sha256Hex(JSON.stringify(context)) };
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
  input: { addendum: Addendum; actor: Actor; onlyIfNone?: boolean },
): Promise<PrepareResult | { status: "exists"; contractId: string }> {
  const addendum = Addendum.parse(input.addendum);
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
    return { ok: true as const, data: run.result.data, helperRunId, inputHash: i.inputHash };
  });
  if (!pre.ok) return { status: "needs_human", reasons: pre.reasons, helperRunId: pre.helperRunId };

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
    await supersedeOpenContracts(ctx, tx, leaseId, `replaced by version ${version}`);

    const d = pre.data;
    const reference = shortRef("C");
    const doc = contractDocument(d.fields, d.addendum, {
      version,
      reference,
      preparedOn: ctx.clock.today(),
      demo: ctx.demoMode,
    });
    const pdf = await renderPdf({ title: doc.title, subject: `${i.lease.ref} ${reference}` }, doc.blocks);
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
    };
    const approval = await requestApproval(ctx, tx, {
      gate: "final_contract",
      entity: { kind: "lease", id: leaseId },
      dedupeKey: `${leaseId}:final_contract:v${version}`,
      title: `Final contract for ${i.lease.ref} (version ${version})`,
      proposal,
      reasons: d.flags.length
        ? d.flags.map((f) => `Addendum ${f.kind.replace("_", " ")}: "${f.quote}" (${f.reason})`)
        : ["Every field is copied from its record. Check them against the sources and the PDF before approving."],
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
      },
      rulesVersion: i.lease.rulesVersion,
    });
    return { status: "prepared" as const, contractId, version, approvalId: approval.id };
  });
}

/** A new version replaces the open one: its approval is cancelled and its signing links stop working. */
async function supersedeOpenContracts(ctx: EngineContext, tx: Tx, leaseId: string, note: string) {
  const open = await tx.db
    .select()
    .from(contracts)
    .where(and(eq(contracts.leaseId, leaseId), inArray(contracts.status, ["pending_approval", "sent"])))
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
  for (const [role, party, nameEn] of [
    ["tenant", i.tenant, c.fields.tenantNameEn],
    ["landlord", i.landlord, c.fields.landlordNameEn],
  ] as const) {
    const signerId = newId();
    await tx.db.insert(contractSigners).values({
      id: signerId,
      contractId: c.id,
      partyId: party.id,
      role,
      nameEn,
      email: party.email,
      createdAt: ctx.clock.now(),
    });
    await queueLeaseMail(ctx, tx, { leaseId: c.leaseId, kind: "sign", key: signerId, seq: 1 });
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
export async function resendSignLink(ctx: EngineContext, leaseId: string, signerId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [s] = await tx.db
      .select({ signer: contractSigners, contract: contracts })
      .from(contractSigners)
      .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
      .where(and(eq(contractSigners.id, signerId), eq(contracts.leaseId, leaseId)))
      .for("update");
    if (!s) throw notFound("signer");
    if (s.contract.status !== "sent" || s.signer.signedAt) throw conflict("This signer has nothing left to sign.");
    const seq = await nextSignSeq(tx, leaseId, signerId);
    await queueLeaseMail(ctx, tx, { leaseId, kind: "sign", key: signerId, seq });
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "SIGN_LINK_RESENT",
      actor,
      payload: { contractId: s.contract.id, signerId, role: s.signer.role, seq },
    });
    return { queued: true, seq };
  });
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
