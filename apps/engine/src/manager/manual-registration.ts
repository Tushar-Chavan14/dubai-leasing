import { renderPdf } from "@leasing/adapters";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import {
  type Actor,
  type CalendarDate,
  compareDates,
  documentKeyLabel,
  type DocumentKey,
  EMIRATE_LABELS,
  formatAed,
  isCalendarDate,
  maskPiiText,
  registrationSystemName,
  toDubaiDate,
} from "@leasing/core";
import {
  applications,
  approvals,
  companies,
  documents,
  ejariSubmissions,
  leaseParties,
  leases,
  parties,
  tasks,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { isPdf } from "@leasing/helpers";
import { registrationFeeFils, registrationFeeFor } from "@leasing/rulebook";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { requestApproval } from "./approvals.ts";
import { signedContract } from "./contracts.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import type { EjariRejectedProposal } from "./gate-rules.ts";
import { createTask } from "./milestones.ts";
import { recordIssued } from "./registration.ts";
import { companyKycConfig } from "./kyc-config.ts";
import { settingsFor } from "./registration-settings.ts";
import { leaseEmirate } from "./registries.ts";

export const MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024;

const handTaskKey = (leaseId: string, submissionId: string) => `${leaseId}:register_by_hand:${submissionId}`;

async function closeTask(tx: Tx, dedupeKey: string) {
  await tx.db
    .update(tasks)
    .set({ status: "done" })
    .where(and(eq(tasks.dedupeKey, dedupeKey), eq(tasks.status, "open")));
}

async function lockedLease(tx: Tx, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
  if (!lease) throw notFound("lease");
  return lease;
}

function assertRegistration(lease: { state: string }) {
  if (lease.state !== "REGISTRATION") throw conflict(`The lease is in ${lease.state}, not REGISTRATION.`, "stale");
}

async function manualSubmission(tx: Tx, leaseId: string, submissionId: string) {
  const [sub] = await tx.db.select().from(ejariSubmissions).where(eq(ejariSubmissions.id, submissionId)).for("update");
  if (!sub || sub.leaseId !== leaseId) throw notFound("submission");
  if (sub.mode !== "manual") throw conflict("That submission is registered online, not by hand.", "not_manual");
  return sub;
}

export type ManualIssuedInput = {
  submissionId: string;
  reference: string;
  issuedOn: CalendarDate;
  feePaidFils: number | null;
  certificate: Uint8Array | null;
};

/** The officer registered the lease by hand and records the portal's reference. Ends in the normal EJARI_ISSUED. */
export async function recordManualIssued(ctx: EngineContext, leaseId: string, input: ManualIssuedInput, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const lease = await lockedLease(tx, leaseId);
    const sub = await manualSubmission(tx, leaseId, input.submissionId);
    const reference = input.reference.trim();
    if (sub.status === "issued") {
      if (sub.ejariNo === reference)
        return { done: true as const, issued: true as const, ejariNo: reference, idempotent: true };
      throw conflict(`This registration was already recorded with reference ${sub.ejariNo}.`, "already_recorded");
    }
    assertRegistration(lease);
    if (sub.status !== "awaiting_manual")
      throw conflict(`The submission is ${sub.status}, not awaiting registration.`, "stale");
    const emirate = await leaseEmirate(tx, lease);
    const settings = await settingsFor(ctx, tx, emirate);
    if (!isCalendarDate(input.issuedOn)) throw unprocessable("The registration date is not a valid date.");
    if (!new RegExp(settings.referencePattern).test(reference))
      throw unprocessable(
        `That reference does not look like a ${settings.portalName} reference. Example: ${settings.referenceExample}`,
        [],
        "bad_reference",
      );
    const today = ctx.clock.today();
    if (compareDates(input.issuedOn, today) > 0) throw unprocessable("The registration date can't be in the future.");
    const contract = await signedContract(tx, leaseId);
    if (contract?.signedAt && compareDates(input.issuedOn, toDubaiDate(contract.signedAt)) < 0)
      throw unprocessable("The registration date can't be before the contract was signed.");
    if (input.feePaidFils !== null && (!Number.isSafeInteger(input.feePaidFils) || input.feePaidFils < 0))
      throw unprocessable("The fee paid is not a valid amount.");
    if (input.certificate) {
      if (input.certificate.byteLength > MAX_CERTIFICATE_BYTES)
        throw unprocessable("The file is larger than 10 MB.", [], "too_big");
      if (!isPdf(input.certificate)) throw unprocessable("The certificate must be a PDF file.", [], "not_pdf");
    }
    const schedule = registrationFeeFor(emirate, input.issuedOn);
    const feeExpectedFils = schedule ? registrationFeeFils(schedule.rule, lease.annualRentFils) : null;
    const feeDiffers = input.feePaidFils !== null && feeExpectedFils !== null && input.feePaidFils !== feeExpectedFils;
    const r = await recordIssued(ctx, tx, sub, reference, input.issuedOn, input.certificate, {
      actor,
      issuedOn: input.issuedOn,
      simulated: false,
      manual: true,
      feePaidFils: input.feePaidFils,
      extraPayload: { reference, feePaidFils: input.feePaidFils, feeExpectedFils, feeDiffers },
    });
    await closeTask(tx, handTaskKey(leaseId, sub.id));
    return { ...r, idempotent: false, feeDiffers };
  });
}

/** The officer records that the portal refused the registration. First: a fix task. Second: the `ejari_rejected_twice` gate. */
export async function recordManualRejected(
  ctx: EngineContext,
  leaseId: string,
  input: { submissionId: string; reasons: string },
  actor: Actor,
) {
  const text = input.reasons.trim();
  if (!text || text.length > 1000) throw unprocessable("Write what the portal said (up to 1000 characters).");
  return withTx(ctx.database, async (tx) => {
    const lease = await lockedLease(tx, leaseId);
    const sub = await manualSubmission(tx, leaseId, input.submissionId);
    if (sub.status === "rejected") return { action: "none" as const, idempotent: true };
    assertRegistration(lease);
    if (sub.status !== "awaiting_manual")
      throw conflict(`The submission is ${sub.status}, not awaiting registration.`, "stale");
    const reasons = [{ code: "MANUAL", field: null, message: maskPiiText(text) }];
    await tx.db
      .update(ejariSubmissions)
      .set({ status: "rejected", reasons, recordedBy: actor, completedAt: ctx.clock.now() })
      .where(eq(ejariSubmissions.id, sub.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "EJARI_REJECTED",
      actor,
      payload: { submissionId: sub.id, attempt: sub.attempt, codes: ["MANUAL"], manual: true },
      rulesVersion: lease.rulesVersion,
    });
    await closeTask(tx, handTaskKey(leaseId, sub.id));
    // Rejections already put to a decided ejari_rejected_twice gate don't count again.
    const decided = await tx.db
      .select({ proposal: approvals.proposal })
      .from(approvals)
      .where(
        and(
          eq(approvals.entityId, leaseId),
          eq(approvals.gate, "ejari_rejected_twice"),
          isNotNull(approvals.decidedAt),
        ),
      );
    const settled = new Set(
      decided.flatMap((d) =>
        ((d.proposal as Partial<EjariRejectedProposal>).attempts ?? []).map((x) => x.submissionId),
      ),
    );
    const rejected = (
      await tx.db
        .select()
        .from(ejariSubmissions)
        .where(and(eq(ejariSubmissions.leaseId, leaseId), eq(ejariSubmissions.status, "rejected")))
        .orderBy(asc(ejariSubmissions.createdAt))
    ).filter((x) => !settled.has(x.id));
    if (rejected.length >= 2) {
      const proposal: EjariRejectedProposal = {
        leaseId,
        leaseRef: lease.ref,
        submissionApprovalId: sub.approvalId,
        attempts: rejected.map((x) => ({
          submissionId: x.id,
          attempt: x.attempt,
          reasons: x.reasons,
          autofix: null,
        })),
        helperRunId: null,
        helperReasons: [],
      };
      const system = registrationSystemName(await leaseEmirate(tx, lease));
      const approval = await requestApproval(ctx, tx, {
        gate: "ejari_rejected_twice",
        entity: { kind: "lease", id: leaseId },
        dedupeKey: `${leaseId}:ejari_rejected:${sub.approvalId}:${sub.id}`,
        title: `${system} rejected ${lease.ref} twice: decide how to proceed`,
        proposal: { ...proposal, systemName: system },
        reasons: rejected.flatMap((x) => x.reasons.map((r) => `${r.code}: ${r.message}`)),
        sources: [],
        rulesVersion: lease.rulesVersion,
        proposedBy: actor,
      });
      return { action: "person" as const, approvalId: approval.id, idempotent: false };
    }
    await createTask(ctx, tx, leaseId, {
      kind: "registration_fix_and_resubmit",
      title: `Fix what the portal rejected for lease ${lease.ref} and re-propose the registration`,
      details: {
        submissionId: sub.id,
        reasons: text.length > 300 ? `${maskPiiText(text).slice(0, 300)}...` : maskPiiText(text),
      },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${leaseId}:registration_fix_and_resubmit:${sub.id}`,
    });
    return { action: "fix_task" as const, idempotent: false };
  });
}

const maskId = (v: string | null) => (v ? `${"*".repeat(Math.max(v.length - 3, 0))}${v.slice(-3)}` : null);

export type PackChecklistItem = {
  key: DocumentKey;
  label: string;
  /** on_file: in the pack or held by us; bring: get it yourself; not_asked: this company's KYC form doesn't ask it. */
  status: "on_file" | "bring" | "not_asked";
  documentId?: string;
  /** Every file attached to the pack for this item (both sides of an ID, the signed contract). */
  attachments?: PackAttachment[];
  /** `answer:` items: the applicant's answer, printed in the pack as typed (not checked). */
  answer?: string;
};

/** A stored file appended to the pack PDF. `store`: generated documents or applicant uploads. */
export type PackAttachment = {
  documentId: string;
  store: "documents" | "uploads";
  label: string;
};

type DocRow = typeof documents.$inferSelect;

/** Verified files only, the newest per side (a re-upload replaces the older one). */
function newestVerifiedPerSide(rows: DocRow[]): DocRow[] {
  const verified = rows
    .filter((d) => d.status === "verified")
    .toSorted(
      (x, y) =>
        (y.verifiedAt?.getTime() ?? 0) - (x.verifiedAt?.getTime() ?? 0) ||
        y.createdAt.getTime() - x.createdAt.getTime(),
    );
  const seen = new Set<string>();
  return verified.filter((d) => {
    if (seen.has(d.side ?? "")) return false;
    seen.add(d.side ?? "");
    return true;
  });
}

/** The data behind the registration pack: what to type into the portal and what to bring. No file is opened. */
export async function registrationPack(tx: Tx, ctx: EngineContext, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId));
  if (!lease) throw notFound("lease");
  const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
  if (!unit) throw notFound("unit");
  const emirate = unit.emirate;
  const settings = await settingsFor(ctx, tx, emirate);
  const people = await tx.db
    .select({ role: leaseParties.role, party: parties })
    .from(leaseParties)
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .where(eq(leaseParties.leaseId, leaseId));
  const tenant = people.find((p) => p.role === "tenant")?.party ?? null;
  const landlord = people.find((p) => p.role === "landlord")?.party ?? null;
  const [company] = await tx.db.select().from(companies).where(eq(companies.id, unit.companyId));
  const policy = await getCompanyPolicy(tx, ctx.clock.today());
  const schedule = registrationFeeFor(emirate, ctx.clock.today());
  const contract = await signedContract(tx, leaseId);
  const [app] = lease.applicationId
    ? await tx.db.select().from(applications).where(eq(applications.id, lease.applicationId))
    : [];
  const kycDocs = app ? await tx.db.select().from(documents).where(eq(documents.applicationId, app.id)) : [];
  // The company's own KYC fields: their labels, and whether this company asks them at all.
  const form = (await companyKycConfig(tx, unit.companyId, ctx.clock.today())).form;
  const fieldLabels = new Map(form.map((f) => [f.key, f.label]));
  const answers = app?.formAnswers?.answers ?? {};
  const checklist: PackChecklistItem[] = settings.requiredDocuments.map((key): PackChecklistItem => {
    const label = documentKeyLabel(key, fieldLabels);
    if (key === "signed_contract") {
      const id = contract?.signedDocumentId ?? undefined;
      return id
        ? {
            key,
            label,
            status: "on_file",
            documentId: id,
            attachments: [{ documentId: id, store: "documents", label }],
          }
        : { key, label, status: "bring" };
    }
    if (key === "landlord_trade_licence")
      return { key, label, status: landlord?.tradeLicenceNo || company?.tradeLicenceNo ? "on_file" : "bring" };
    if (key.startsWith("answer:")) {
      const field = form.find((f) => f.key === key.slice(7) && f.type !== "document");
      if (!field) return { key, label, status: "not_asked" };
      const answer = answers[field.key]?.trim();
      return answer ? { key, label, status: "on_file", answer } : { key, label, status: "bring" };
    }
    if (key.startsWith("kyc:")) {
      const kind = key.slice(4);
      if (kind.startsWith("other:")) {
        const field = form.find((f) => f.key === kind.slice(6) && f.type === "document");
        if (!field) return { key, label, status: "not_asked" };
      } else if (!form.some((f) => f.type === "document" && f.documentKind?.startsWith(kind))) {
        return { key, label, status: "not_asked" };
      }
      // Custom fields are stored as `other:<field key>`; ID cards as `emirates_id` with a front and a back.
      const files = newestVerifiedPerSide(kycDocs.filter((d) => d.kind === kind));
      if (!files.length) return { key, label, status: "bring" };
      return {
        key,
        label,
        status: "on_file",
        documentId: files[0]!.id,
        attachments: files.map((d) => ({
          documentId: d.id,
          store: "uploads" as const,
          label: `${label}${d.side && d.side !== "page" ? ` (${d.side})` : ""}`,
        })),
      };
    }
    return { key, label, status: "bring" };
  });
  return {
    leaseId,
    leaseRef: lease.ref,
    state: lease.state,
    rulesVersion: lease.rulesVersion,
    unit: {
      code: unit.code,
      unitNo: unit.unitNo,
      building: unit.building,
      community: unit.community,
      emirate,
      emirateLabel: EMIRATE_LABELS[emirate],
    },
    tenant: tenant
      ? {
          name: tenant.fullNameEn,
          kind: tenant.kind,
          idKind: tenant.emiratesIdNo ? "Emirates ID" : tenant.passportNo ? "Passport" : null,
          idMasked: maskId(tenant.emiratesIdNo ?? tenant.passportNo),
        }
      : null,
    landlord: {
      name: landlord?.fullNameEn ?? company?.name ?? null,
      tradeLicenceNo: landlord?.tradeLicenceNo ?? company?.tradeLicenceNo ?? null,
    },
    term: { startOn: lease.startOn, endOn: lease.endOn },
    annualRentFils: lease.annualRentFils,
    cheques: lease.cheques,
    depositFils: lease.depositFils,
    fee: {
      feeFils: schedule ? registrationFeeFils(schedule.rule, lease.annualRentFils) : null,
      paidBy: policy.registrationFeePaidBy,
    },
    registration: {
      system: registrationSystemName(emirate),
      mode: settings.mode,
      portalName: settings.portalName,
      portalUrl: settings.portalUrl,
      instructions: settings.instructions,
      referenceExample: settings.referenceExample,
    },
    checklist,
  };
}
export type RegistrationPack = Awaited<ReturnType<typeof registrationPack>>;

/** A stored file ready to append: its PDF pages, or one image (WebP converted to PNG). Null if unreadable. */
type Prepared =
  | { label: string; documentId: string; pdf: PDFDocument; pages: number }
  | { label: string; documentId: string; image: { bytes: Uint8Array; png: boolean }; pages: 1 };

async function prepareFile(bytes: Uint8Array, mime: string | null, f: PackAttachment): Promise<Prepared | null> {
  try {
    if (isPdf(bytes) || mime === "application/pdf") {
      const pdf = await PDFDocument.load(bytes);
      return { label: f.label, documentId: f.documentId, pdf, pages: pdf.getPageCount() };
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50)
      return { label: f.label, documentId: f.documentId, image: { bytes, png: true }, pages: 1 };
    if (bytes[0] === 0xff && bytes[1] === 0xd8)
      return { label: f.label, documentId: f.documentId, image: { bytes, png: false }, pages: 1 };
    // WebP (applicants may upload it): PDF can't hold it, so it is converted locally to PNG.
    const riff = new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF";
    if (riff && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") {
      const png = new Uint8Array(await sharp(bytes).png().toBuffer());
      return { label: f.label, documentId: f.documentId, image: { bytes: png, png: true }, pages: 1 };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * One PDF for the office (D62): page 1 is how to register (numbered steps, with the page each document starts on),
 * then the lease facts, the applicant's answers and the checklist, then every attached document in checklist order.
 * Contains personal data: leasing roles only, never emailed.
 */
export async function registrationPackPdf(
  tx: Tx,
  ctx: EngineContext,
  leaseId: string,
): Promise<{ pdf: Uint8Array; attached: string[]; missing: string[] }> {
  const p = await registrationPack(tx, ctx, leaseId);
  const r = p.registration;
  const meta = {
    title: `Registration pack - ${r.system} - lease ${p.leaseRef}`,
    subject: `Registration pack ${p.leaseRef}`,
  };
  // Load every attachment first, so the steps page can say where each one starts.
  const ready: Prepared[] = [];
  const missing: string[] = [];
  for (const f of p.checklist.flatMap((c) => c.attachments ?? [])) {
    const [doc] = await tx.db.select().from(documents).where(eq(documents.id, f.documentId));
    const bytes = doc
      ? await (f.store === "documents" ? ctx.documents : ctx.uploads).read(doc.path).catch(() => null)
      : null;
    const prepared = doc && bytes ? await prepareFile(new Uint8Array(bytes), doc.mime, f) : null;
    if (prepared) ready.push(prepared);
    else missing.push(f.label);
  }
  const answers = p.checklist.filter((c) => c.answer !== undefined);
  const details = await renderPdf(meta, [
    { kind: "heading", text: "Lease details" },
    {
      kind: "facts",
      rows: [
        ["Unit", `${p.unit.unitNo ?? p.unit.code}, ${p.unit.building}, ${p.unit.emirateLabel}`],
        ["Tenant", `${p.tenant?.name ?? "-"}${p.tenant?.idKind ? ` (${p.tenant.idKind} ${p.tenant.idMasked})` : ""}`],
        [
          "Landlord",
          `${p.landlord.name ?? "-"}${p.landlord.tradeLicenceNo ? ` (licence ${p.landlord.tradeLicenceNo})` : ""}`,
        ],
        ["Term", `${p.term.startOn} to ${p.term.endOn}`],
        ["Annual rent", formatAed(p.annualRentFils)],
        ["Cheques", String(p.cheques)],
        ["Security deposit", formatAed(p.depositFils)],
        [
          "Registration fee",
          p.fee.feeFils === null
            ? "Not in the fee schedule"
            : `${formatAed(p.fee.feeFils)}, paid by the ${p.fee.paidBy}`,
        ],
      ],
    },
    ...(answers.length
      ? [
          { kind: "heading" as const, text: "Applicant's answers (as typed, not checked)" },
          {
            kind: "facts" as const,
            rows: answers.map((c): [string, string] => [c.label.replace(/^Applicant's answer: /, ""), c.answer!]),
          },
        ]
      : []),
    { kind: "heading", text: "Documents" },
    {
      kind: "list",
      items: p.checklist.map((c) => {
        const tag = c.attachments?.length
          ? "[in this pack]"
          : c.answer !== undefined
            ? "[answer above]"
            : c.status === "not_asked"
              ? "[not asked by this company: get it from the tenant]"
              : c.status === "on_file"
                ? "[on file, not attached]"
                : "[bring]";
        return `${tag} ${c.label}`;
      }),
    },
  ]);
  const detailsPages = (await PDFDocument.load(details)).getPageCount();
  const steps = async (stepsPages: number) => {
    let page = stepsPages + detailsPages + 1;
    const where = ready.map((f) => {
      const line = `${f.label}: page ${page}`;
      page += f.pages;
      return line;
    });
    const bring = p.checklist.filter((c) => !c.attachments?.length && c.answer === undefined).map((c) => c.label);
    return renderPdf(meta, [
      { kind: "title", text: `Registration pack — ${r.system} — lease ${p.leaseRef}` },
      {
        kind: "small",
        text: "Generated by the leasing system; not a government document. Contains personal data: keep it inside the office and don't email it.",
      },
      { kind: "heading", text: "How to register" },
      {
        kind: "list",
        items: [
          `1. Open ${r.portalName}${r.portalUrl ? ` (${r.portalUrl})` : ""}.`,
          ...(r.instructions
            ? [`2. Follow the office's steps: ${r.instructions}`]
            : ["2. Start a new tenancy registration."]),
          `3. Enter the lease details exactly as on page ${stepsPages + 1} (they match the signed contract).`,
          ready.length
            ? "4. Upload or hand over the documents in this pack, in this order:"
            : "4. No document could be attached; collect them from the list below.",
          ...where.map((w) => `    - ${w}`),
          ...(bring.length ? ["    Bring separately: " + bring.join("; ") + "."] : []),
          ...(missing.length ? [`    Could not attach (bring these): ${missing.join("; ")}.`] : []),
          `5. Pay the registration fee${p.fee.feeFils === null ? "" : ` (${formatAed(p.fee.feeFils)}, paid by the ${p.fee.paidBy})`}.`,
          `6. Back in the leasing app, record the reference (it looks like ${r.referenceExample}) on lease ${p.leaseRef} and upload the certificate.`,
        ],
      },
    ]);
  };
  let cover = await steps(1);
  const coverPages = (await PDFDocument.load(cover)).getPageCount();
  if (coverPages !== 1) cover = await steps(coverPages);

  const out = await PDFDocument.load(cover);
  const detailsDoc = await PDFDocument.load(details);
  for (const pg of await out.copyPages(detailsDoc, detailsDoc.getPageIndices())) out.addPage(pg);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const attached: string[] = [];
  for (const f of ready) {
    if ("pdf" in f) {
      for (const pg of await out.copyPages(f.pdf, f.pdf.getPageIndices())) out.addPage(pg);
    } else {
      const img = f.image.png ? await out.embedPng(f.image.bytes) : await out.embedJpg(f.image.bytes);
      const page = out.addPage([595.28, 841.89]);
      page.drawText(f.label, { x: 48, y: 800, size: 11, font });
      const scale = Math.min(499 / img.width, 720 / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (595.28 - w) / 2, y: 780 - h, width: w, height: h });
    }
    attached.push(f.documentId);
  }
  if (missing.length) {
    const page = out.addPage([595.28, 841.89]);
    page.drawText("Could not attach (bring these separately):", { x: 48, y: 780, size: 12, font });
    missing.forEach((m, i) => page.drawText(`- ${m}`, { x: 48, y: 756 - i * 18, size: 11, font }));
  }
  return { pdf: await out.save(), attached, missing };
}

/** The open `register_by_hand` task of a lease, if any. */
export async function openRegisterTask(tx: Tx, leaseId: string) {
  const [t] = await tx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.entityId, leaseId), eq(tasks.kind, "register_by_hand"), eq(tasks.status, "open")))
    .limit(1);
  return t?.id ?? null;
}
