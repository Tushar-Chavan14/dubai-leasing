import {
  type Actor,
  DEFAULT_REGISTRATION_SETTINGS,
  type Emirate,
  EMIRATE_LABELS,
  EMIRATES,
  DOCUMENT_KEYS,
  documentKeyLabel,
  KYC_DOCUMENT_KINDS,
  RegistrationSettings,
} from "@leasing/core";
import { companies, registrationSettings, type Tx } from "@leasing/db";
import { eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { unprocessable } from "../errors.ts";
import { appendEvent } from "./events.ts";
import { companyKycConfig } from "./kyc-config.ts";
import { registryFor } from "./registries.ts";

export type EffectiveRegistrationSettings = RegistrationSettings & {
  source: "default" | "saved";
  /** The stored or default mode is online but no registry adapter exists, so staff register by hand. */
  forcedManual: boolean;
};

/** Settings in force for an emirate: the admin's saved row, else the code default. */
export async function settingsFor(
  ctx: EngineContext,
  tx: Tx,
  emirate: Emirate,
): Promise<EffectiveRegistrationSettings> {
  const [row] = await tx.db.select().from(registrationSettings).where(eq(registrationSettings.emirate, emirate));
  // Rows are validated on write; an invalid stored row is a data error and throws.
  const values = row ? RegistrationSettings.parse(row.values) : DEFAULT_REGISTRATION_SETTINGS[emirate];
  const forcedManual = values.mode === "online" && !registryFor(ctx, emirate);
  return { ...values, mode: forcedManual ? "manual" : values.mode, source: row ? "saved" : "default", forcedManual };
}

export async function allSettings(ctx: EngineContext, tx: Tx) {
  const out = {} as Record<Emirate, EffectiveRegistrationSettings>;
  for (const e of EMIRATES) out[e] = await settingsFor(ctx, tx, e);
  return out;
}

/** Fixed audit entity id per emirate (settings have no row id of their own). */
export function settingsEntityId(emirate: Emirate): string {
  const n = EMIRATES.indexOf(emirate).toString(16).padStart(12, "0");
  return `00000000-0000-7000-8000-${n}`;
}

/** Validates and stores an emirate's registration settings (admin only at the route) and audits it. */
export async function saveRegistrationSettings(
  ctx: EngineContext,
  tx: Tx,
  emirate: Emirate,
  input: unknown,
  actor: Actor,
): Promise<EffectiveRegistrationSettings> {
  const values = RegistrationSettings.parse(input);
  if (values.mode === "online" && !registryFor(ctx, emirate))
    throw unprocessable(`no online registry for ${EMIRATE_LABELS[emirate]}; use manual`, [], "no_online_registry");
  const before = await settingsFor(ctx, tx, emirate);
  const now = ctx.clock.now();
  await tx.db
    .insert(registrationSettings)
    .values({ emirate, values, updatedBy: actor, updatedAt: now })
    .onConflictDoUpdate({ target: registrationSettings.emirate, set: { values, updatedBy: actor, updatedAt: now } });
  await appendEvent(tx, ctx, {
    entity: { kind: "settings", id: settingsEntityId(emirate) },
    type: "REGISTRATION_SETTINGS_UPDATED",
    actor,
    payload: {
      emirate,
      from: { mode: before.mode, portalName: before.portalName, source: before.source },
      to: values,
    },
    rulesVersion: ctx.rulesVersion,
  });
  return settingsFor(ctx, tx, emirate);
}

export interface DocumentOption {
  key: string;
  label: string;
  group: "kyc_document" | "kyc_answer" | "other";
  /** Companies whose current KYC form asks it (company fields only). */
  companies?: string[];
}

/**
 * Everything an emirate's checklist can include (D62): the fixed documents, the standard ID documents, and every
 * document field and question on any company's current KYC form (keyed by field key; same key, same item).
 */
export async function registrationDocumentOptions(ctx: EngineContext, tx: Tx): Promise<DocumentOption[]> {
  const today = ctx.clock.today();
  const custom = new Map<string, DocumentOption>();
  for (const c of await tx.db.select({ id: companies.id, name: companies.name }).from(companies)) {
    for (const f of (await companyKycConfig(tx, c.id, today)).form) {
      const isDoc = f.type === "document";
      // Standard ID documents are listed once below; the name field is already on the contract.
      if (isDoc && f.documentKind !== "custom" && f.documentKind !== "other") continue;
      if (!isDoc && f.nameAsPerDocuments) continue;
      const key = isDoc ? `kyc:other:${f.key}` : `answer:${f.key}`;
      const o = custom.get(key) ?? {
        key,
        label: documentKeyLabel(key, new Map([[f.key, f.label]])),
        group: isDoc ? ("kyc_document" as const) : ("kyc_answer" as const),
        companies: [],
      };
      o.companies!.push(c.name);
      custom.set(key, o);
    }
  }
  return [
    ...KYC_DOCUMENT_KINDS.map((k) => ({
      key: `kyc:${k}`,
      label: documentKeyLabel(`kyc:${k}`),
      group: "kyc_document" as const,
    })),
    ...[...custom.values()].filter((o) => o.group === "kyc_document"),
    ...[...custom.values()].filter((o) => o.group === "kyc_answer"),
    ...DOCUMENT_KEYS.options.map((k) => ({ key: k, label: documentKeyLabel(k), group: "other" as const })),
  ];
}
