import { createHash } from "node:crypto";
import { type PdfBlock, renderPdf } from "@platform/adapters";
import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { formatMoneyFils } from "@platform/readers/structure/format";
import { type SpaRole, stageLabel } from "@spa/core";
import {
  amlCases,
  amlHits,
  dealParties,
  deals,
  documents,
  helperRuns,
  parties,
  riskAssessments,
  screenings,
  spaApprovals,
  spaExports,
  spaUsers,
  withSpaTx,
} from "@spa/db";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { requireCompliance } from "./compliance.ts";
import type { SpaContext } from "./context.ts";
import { csvLine } from "./csv.ts";
import { conflict, notFound, unavailable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { type ZipFile, writeZip } from "./zip.ts";

/** The file store the pack is built from and kept in (the engine passes its `LocalDiskStore`). */
export interface ExportStore {
  put(bytes: Uint8Array, ext: string): Promise<{ sha256: string; path: string; bytes: number }>;
  read(key: string): Promise<Uint8Array>;
}

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** A file name that is safe inside a folder: no path, no odd characters, at most 80 characters. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 80);
  return clean || "file";
}

export interface CasePack {
  exportId: string;
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  fileCount: number;
}

/**
 * Exports one deal as a ZIP for a compliance role (S29, S62): `summary.pdf`, the deal's documents, `screenings.json`,
 * `decisions.csv` and a `manifest.json` that hashes every other file. Nothing here is computed by a model. A stored file
 * that is missing or no longer matches its recorded hash stops the export. Each export is an `exports` row and a
 * compliance-only `CASE_EXPORTED` event; the ZIP is kept in the store.
 */
export async function exportCasePack(
  ctx: SpaContext,
  deps: { store: ExportStore },
  dealId: string,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<CasePack> {
  requireCompliance(user);
  const db = ctx.database.db;
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw notFound("deal");
  const now = ctx.clock.now();

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.dealId, dealId))
    .orderBy(asc(documents.uploadedAt), asc(documents.id));
  const files: ZipFile[] = [];
  for (const d of docs) {
    let bytes: Uint8Array;
    try {
      bytes = await deps.store.read(d.storageKey);
    } catch {
      throw unavailable(
        "export_file_missing",
        "a document of this deal can't be read from storage, so nothing was exported",
      );
    }
    if (sha(bytes) !== d.sha256)
      throw conflict(
        "export_file_changed",
        "a stored document no longer matches its recorded hash, so nothing was exported",
      );
    files.push({ name: `documents/${d.kind}-${d.id.slice(-8)}-${safeName(d.fileName)}`, bytes });
  }

  const screens = await db
    .select()
    .from(screenings)
    .where(eq(screenings.dealId, dealId))
    .orderBy(asc(screenings.screenedAt), asc(screenings.id));
  const cases = await db
    .select()
    .from(amlCases)
    .where(eq(amlCases.dealId, dealId))
    .orderBy(asc(amlCases.openedAt), asc(amlCases.id));
  const hits = cases.length
    ? await db
        .select()
        .from(amlHits)
        .where(
          inArray(
            amlHits.caseId,
            cases.map((c) => c.id),
          ),
        )
        .orderBy(asc(amlHits.createdAt), asc(amlHits.id))
    : [];
  const risks = await db
    .select()
    .from(riskAssessments)
    .where(eq(riskAssessments.dealId, dealId))
    .orderBy(asc(riskAssessments.createdAt), asc(riskAssessments.id));
  const screeningsJson = enc(
    `${JSON.stringify(
      {
        screenings: screens,
        cases: cases.map((c) => ({ ...c, hits: hits.filter((h) => h.caseId === c.id) })),
        riskAssessments: risks,
      },
      null,
      2,
    )}\n`,
  );

  const approvals = await db
    .select()
    .from(spaApprovals)
    .where(and(eq(spaApprovals.entityId, dealId), ne(spaApprovals.status, "pending")))
    .orderBy(asc(spaApprovals.decidedAt), asc(spaApprovals.id));
  const runs = await db
    .select()
    .from(helperRuns)
    .where(eq(helperRuns.dealId, dealId))
    .orderBy(asc(helperRuns.createdAt), asc(helperRuns.id));
  type Row = { at: Date; id: string; cells: (string | number | null)[] };
  const rows: Row[] = [
    ...approvals.map((a) => ({
      at: a.decidedAt ?? a.createdAt,
      id: a.id,
      cells: [
        "approval",
        a.id,
        iso(a.decidedAt ?? a.createdAt),
        a.gate,
        a.outcome ?? a.status,
        a.decidedBy ? `user:${a.decidedBy}` : a.proposedBy,
        maskPiiText(a.decisionNote ?? ""),
        a.rulesVersion,
        deal.policyVersion,
        null,
        null,
      ],
    })),
    ...runs.map((r) => ({
      at: r.createdAt,
      id: r.id,
      cells: [
        "helper_run",
        r.id,
        iso(r.createdAt),
        r.helper,
        r.status,
        `helper:${r.helper}`,
        maskPiiText(r.reasons.join("; ")),
        r.rulesVersion,
        null,
        r.kycConfigVersion,
        r.amlPolicyVersion,
      ],
    })),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : 1));
  const decisionsCsv = enc(
    csvLine([
      "source",
      "id",
      "at",
      "gate_or_helper",
      "outcome",
      "actor",
      "reason",
      "rulebook",
      "policy_version",
      "kyc_config_version",
      "aml_policy_version",
    ]) + rows.map((r) => csvLine(r.cells)).join(""),
  );

  const people = await db
    .select({ role: dealParties.role, order: dealParties.order, name: parties.fullNameEn, kind: parties.kind })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(eq(dealParties.dealId, dealId))
    .orderBy(asc(dealParties.role), asc(dealParties.order));
  const blocks: PdfBlock[] = [
    { kind: "title", text: `Case summary ${deal.ref}` },
    {
      kind: "meta",
      rows: [
        ["Exported", `${now.toISOString()} by user:${user.id}`],
        ["Simulated environment", "Fictional or demo data may appear here."],
      ],
    },
    { kind: "heading", text: "Deal" },
    {
      kind: "facts",
      rows: [
        ["Reference", deal.ref],
        ["Type", deal.dealType],
        ["Stage", stageLabel(deal.state)],
        ["Price", formatMoneyFils(deal.priceFils)],
        ["Rulebook", deal.rulesVersion],
        ["Company policy version", String(deal.policyVersion)],
      ],
    },
    { kind: "heading", text: "Parties" },
    { kind: "list", items: people.map((p) => `${p.role}: ${p.name} (${p.kind})`) },
    { kind: "heading", text: "What is in this pack" },
    {
      kind: "facts",
      rows: [
        ["Documents", String(docs.length)],
        ["Screenings", String(screens.length)],
        ["Cases", String(cases.length)],
        ["Decisions", String(rows.length)],
      ],
    },
    {
      kind: "small",
      text: "decisions.csv lists every decision with who made it, why, the gate and the versions in force. manifest.json holds the SHA-256 of every file.",
    },
  ];
  const summary = await renderPdf({ title: `Case summary ${deal.ref}`, subject: "Compliance case export" }, blocks);

  const body: ZipFile[] = [
    { name: "summary.pdf", bytes: summary },
    ...files,
    { name: "screenings.json", bytes: screeningsJson },
    { name: "decisions.csv", bytes: decisionsCsv },
  ];
  const manifest = enc(
    `${JSON.stringify(
      {
        deal: deal.ref,
        generatedAt: now.toISOString(),
        files: body.map((f) => ({ name: f.name, bytes: f.bytes.byteLength, sha256: sha(f.bytes) })),
      },
      null,
      2,
    )}\n`,
  );
  const zip = writeZip([...body, { name: "manifest.json", bytes: manifest }]);
  const digest = sha(zip);
  const stored = await deps.store.put(zip, "zip");
  const exportId = newId();
  const fileCount = body.length + 1;
  await withSpaTx(ctx.database, async (tx) => {
    await tx.db.insert(spaExports).values({
      id: exportId,
      dealId,
      kind: "case_pack",
      requestedBy: user.id,
      requestedAt: now,
      sha256: digest,
      sizeBytes: zip.byteLength,
      storageKey: stored.path,
      fileCount,
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "CASE_EXPORTED",
      actor: `user:${user.id}`,
      payload: { exportId, sha256: digest, fileCount },
      rulesVersion: deal.rulesVersion,
    });
  });
  return { exportId, fileName: `case-${deal.ref}.zip`, bytes: zip, sha256: digest, fileCount };
}

/** The export log, newest first, for a compliance role: who exported what, and when. */
export async function listExports(ctx: SpaContext, user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined }, limit = 100) {
  requireCompliance(user);
  const rows = await ctx.database.db
    .select({
      id: spaExports.id,
      kind: spaExports.kind,
      dealRef: deals.ref,
      requestedBy: spaExports.requestedBy,
      requestedByName: spaUsers.name,
      requestedAt: spaExports.requestedAt,
      sha256: spaExports.sha256,
      sizeBytes: spaExports.sizeBytes,
      fileCount: spaExports.fileCount,
    })
    .from(spaExports)
    .leftJoin(deals, eq(deals.id, spaExports.dealId))
    .innerJoin(spaUsers, eq(spaUsers.id, spaExports.requestedBy))
    .orderBy(desc(spaExports.requestedAt), desc(spaExports.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, requestedAt: r.requestedAt.toISOString() }));
}
