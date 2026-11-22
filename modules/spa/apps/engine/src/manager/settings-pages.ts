import { DEFAULT_COMPANY_KIND, type SpaPolicy, SpaRole } from "@spa/core";
import { companies, parties, signatories, spaDemoSettings, spaUsers, withSpaTx } from "@spa/db";
import {
  getSalesRulebook,
  isPending,
  registrationFee,
  type RulebookField,
  type SalesRulebook,
  salesRulebookOn,
} from "@spa/rulebook";
import { asc, eq, or } from "drizzle-orm";
import { z } from "zod";
import type { SpaDemoClock } from "../clock.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { setCompany } from "./parties.ts";
import { currentPolicy, publishPolicy } from "./policy.ts";

/** The remaining Settings pages (C40, S72). Admin writes; an admin or a sales manager reads; nobody else. */
type Who = { id: string; role: SpaRole };

const READERS: readonly SpaRole[] = ["admin", "sales_manager"];
const needReader = (user: Who) => {
  if (!READERS.includes(user.role)) throw forbidden("you can't view these settings");
};
const needAdmin = (user: Who) => {
  if (user.role !== "admin") throw forbidden("only an admin changes these settings");
};

// ---------------------------------------------------------------------------------------------
// Company and signatories

export async function getCompany(ctx: SpaContext, user: Who) {
  needReader(user);
  const [row] = await ctx.database.db.select().from(companies).limit(1);
  const rows = await ctx.database.db
    .select({
      company: signatories.companyPartyId,
      person: signatories.personPartyId,
      title: signatories.title,
      authority: signatories.authority,
    })
    .from(signatories);
  const all = await ctx.database.db
    .select({ id: parties.id, kind: parties.kind, name: parties.fullNameEn })
    .from(parties)
    .orderBy(asc(parties.fullNameEn));
  const nameOf = new Map(all.map((p) => [p.id, p.name]));
  return {
    company: { name: row?.name ?? "", kind: row?.kind ?? DEFAULT_COMPANY_KIND },
    // Names, titles and what lets the person sign: no number, no owner, no document (S72).
    signatories: all
      .filter((p) => p.kind === "company")
      .slice(0, 200)
      .map((c) => ({
        companyName: c.name,
        signatories: rows
          .filter((r) => r.company === c.id)
          .map((r) => ({ name: nameOf.get(r.person) ?? "", title: r.title, authority: r.authority })),
      })),
  };
}

/** Name and kind of the client company: the admin check, then the existing `setCompany` (which validates and audits). */
export async function saveCompany(ctx: SpaContext, user: Who, body: unknown): Promise<{ ok: true }> {
  needAdmin(user);
  await setCompany(ctx, body, `user:${user.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Plans and signing: company policy, page by page

export const PLAN_KEYS = [
  "maxDiscountBps",
  "commission",
  "depositBps",
  "holdDays",
  "offerValidityDays",
  "instalmentReminders",
] as const;
export const SIGNING_KEYS = ["signingLinkDays", "signingOrder"] as const;
/** The fixed page allowlist: nothing else in the policy is reachable from these routes. */
const POLICY_PAGES: Record<string, readonly (keyof SpaPolicy)[]> = { plans: PLAN_KEYS, signing: SIGNING_KEYS };

const pageKeys = (page: string) => {
  const keys = Object.hasOwn(POLICY_PAGES, page) ? POLICY_PAGES[page] : undefined;
  if (!keys) throw notFound("settings page");
  return keys;
};
const pick = (policy: SpaPolicy, keys: readonly (keyof SpaPolicy)[]) =>
  Object.fromEntries(keys.map((k) => [k, policy[k]]));

export async function getPolicyPage(ctx: SpaContext, user: Who, page: string) {
  needReader(user);
  const keys = pageKeys(page);
  const current = await currentPolicy(ctx.database.db);
  return { page, version: current.version, values: pick(current.values, keys) };
}

const PolicyBody = z
  .object({ baseVersion: z.number().int().min(0), values: z.record(z.string(), z.unknown()) })
  .strict();

/**
 * Saves one page of the policy as a new version through `publishPolicy`. Only the page's keys are laid over the latest
 * policy (a key from anywhere else is 422), the whole document is validated again, and a `baseVersion` that is not the
 * latest is 409: the person looks again instead of overwriting someone else's save. Running deals keep their pinned version (S37).
 */
export async function savePolicyPage(
  ctx: SpaContext,
  user: Who,
  page: string,
  body: unknown,
): Promise<{ version: number }> {
  needAdmin(user);
  const keys = pageKeys(page);
  const p = PolicyBody.safeParse(body);
  if (!p.success) throw unprocessable("invalid_request", "send the version you started from and the values");
  const extra = Object.keys(p.data.values).filter((k) => !(keys as readonly string[]).includes(k));
  if (extra.length) throw unprocessable("invalid_request", "those values aren't on this page");
  const current = await currentPolicy(ctx.database.db);
  if (current.version !== p.data.baseVersion)
    throw conflict("stale_policy", "someone saved a newer version; look again and try once more");
  const merged = {
    ...current.values,
    ...Object.fromEntries(keys.filter((k) => k in p.data.values).map((k) => [k, p.data.values[k]])),
  };
  return publishPolicy(ctx, merged, user, { expectVersion: p.data.baseVersion });
}

// ---------------------------------------------------------------------------------------------
// Fees and rulebook (read-only)

type Kind = "bps" | "fils" | "text";
const SETTING_ROWS: readonly { key: keyof SalesRulebook; label: string; kind: Kind }[] = [
  { key: "registrationFeeBps", label: "Registration fee (DLD)", kind: "bps" },
  { key: "registrationFeePayer", label: "Who pays the registration fee", kind: "text" },
  { key: "oqoodAdminFeeFils", label: "Oqood admin fee", kind: "fils" },
  { key: "oqoodTransferFeeFils", label: "Oqood transfer fee", kind: "fils" },
  { key: "trusteeFeeFils", label: "Trustee fee", kind: "fils" },
  { key: "mortgageRegistrationBps", label: "Mortgage registration fee", kind: "bps" },
  { key: "mortgageRegistrationAdminFils", label: "Mortgage registration admin fee", kind: "fils" },
  { key: "minBookingBps", label: "Minimum booking payment (off-plan)", kind: "bps" },
];
/** The rulebook keys the Fees page shows. A new rulebook key is in this list or in the omitted one: a test fails otherwise. */
export const RULEBOOK_SETTING_KEYS: readonly string[] = SETTING_ROWS.map((r) => r.key);
/** Keys no role sees on this page (S72): the compliance thresholds belong to compliance. */
export const RULEBOOK_AML_KEYS: readonly string[] = [
  "amlCashThresholdFils",
  "amlNameMatchThreshold",
  "beneficialOwnerBps",
];
/** The price the fee preview is worked on: AED 1,000,000, in fils. */
const SAMPLE_PRICE_FILS = 100_000_000;

export async function getRulebookSettings(ctx: SpaContext, user: Who) {
  needReader(user);
  const lookup = ctx.rulebook ?? getSalesRulebook;
  const version = salesRulebookOn("dubai", ctx.clock.today())?.version ?? null;
  const rb = version ? lookup(version) : null;
  if (!rb) throw unprocessable("rulebook_unavailable", "no rulebook is in force");
  const items = SETTING_ROWS.map(({ key, label, kind }) => {
    const base = { key, label, kind };
    if (isPending(rb, key as RulebookField)) return { ...base, status: "pending" as const };
    const v = rb[key] as unknown;
    if (kind === "bps" && typeof v === "number") return { ...base, status: "confirmed" as const, bps: v };
    if (kind === "fils" && typeof v === "number") return { ...base, status: "confirmed" as const, amountFils: v };
    return { ...base, status: "confirmed" as const, value: String(v) };
  });
  const fee = registrationFee(SAMPLE_PRICE_FILS, rb);
  return {
    rulesVersion: rb.version,
    effectiveFrom: String(rb.effectiveFrom),
    sources: [...rb.sources],
    items,
    feePreview: fee.ok
      ? {
          priceFils: SAMPLE_PRICE_FILS,
          status: "ready" as const,
          totalFils: fee.totalFils,
          buyerFils: fee.buyerFils,
          sellerFils: fee.sellerFils,
        }
      : { priceFils: SAMPLE_PRICE_FILS, status: "pending" as const },
  };
}

// ---------------------------------------------------------------------------------------------
// Users and roles (admin only)

const USERS_SETTINGS = { kind: "settings" as const, id: "00000000-0000-7000-8000-000000000041" };

export async function listUsers(ctx: SpaContext, user: Who) {
  needAdmin(user);
  // Named columns only: the password hash never leaves the table.
  const rows = await ctx.database.db
    .select({
      id: spaUsers.id,
      name: spaUsers.name,
      email: spaUsers.email,
      role: spaUsers.role,
      active: spaUsers.active,
    })
    .from(spaUsers)
    .orderBy(asc(spaUsers.name), asc(spaUsers.id));
  return { items: rows.map((r) => ({ ...r, isYou: r.id === user.id })) };
}

const UserChange = z.union([
  z.strictObject({ role: SpaRole }),
  z.strictObject({ active: z.boolean() }),
  z.strictObject({ role: SpaRole, active: z.boolean() }),
]);

/**
 * Changes one user's role and/or active flag. You can't change yourself, and the last active admin can't be demoted or
 * removed. The rows are locked in one ordered statement so two admins changing each other at once can't both pass the guard.
 * Each change is one audit event; a change to the same value writes nothing. No create and no password: accounts come from the portal CLI.
 */
export async function changeUser(
  ctx: SpaContext,
  user: Who,
  targetId: string,
  body: unknown,
): Promise<{ changed: boolean }> {
  needAdmin(user);
  const p = UserChange.safeParse(body);
  if (!p.success) throw unprocessable("invalid_request", "send a role, an active flag, or both");
  if (targetId === user.id) throw conflict("self_change", "you can't change your own role or access");
  return withSpaTx(ctx.database, async (tx) => {
    const locked = await tx.db
      .select()
      .from(spaUsers)
      .where(or(eq(spaUsers.id, targetId), eq(spaUsers.role, "admin")))
      .orderBy(asc(spaUsers.id))
      .for("update");
    const target = locked.find((u) => u.id === targetId);
    if (!target) throw notFound("user");
    const role = "role" in p.data ? p.data.role : target.role;
    const active = "active" in p.data ? p.data.active : target.active;
    const stopsBeingActiveAdmin = target.role === "admin" && target.active && (role !== "admin" || !active);
    if (stopsBeingActiveAdmin && locked.filter((u) => u.role === "admin" && u.active && u.id !== targetId).length === 0)
      throw conflict("last_admin", "there must be at least one active admin");
    let changed = false;
    if (role !== target.role) {
      await appendDealEvent(tx, ctx, {
        entity: USERS_SETTINGS,
        type: "USER_ROLE_CHANGED",
        actor: `user:${user.id}`,
        payload: { userId: target.id, from: target.role, to: role },
      });
      changed = true;
    }
    if (active !== target.active) {
      await appendDealEvent(tx, ctx, {
        entity: USERS_SETTINGS,
        type: "USER_ACTIVE_SET",
        actor: `user:${user.id}`,
        payload: { userId: target.id, active },
      });
      changed = true;
    }
    if (changed) await tx.db.update(spaUsers).set({ role, active }).where(eq(spaUsers.id, target.id));
    return { changed };
  });
}

// ---------------------------------------------------------------------------------------------
// Models and integrations (read-only facts)

export interface SettingsModelTags {
  vision?: string | null | undefined;
  chat?: string | null | undefined;
  decision?: string | null | undefined;
  assistant?: string | null | undefined;
  copilot?: string | null | undefined;
}
const MODEL_ROWS: readonly { key: keyof SettingsModelTags; label: string }[] = [
  { key: "vision", label: "Reading documents (vision)" },
  { key: "chat", label: "Writing and summaries (chat)" },
  { key: "decision", label: "Choosing between options (decision)" },
  { key: "assistant", label: "Buyer, seller and visitor assistants" },
  { key: "copilot", label: "Staff copilot" },
];

/** Tags from the engine's environment (S59). A value that looks like an address is never shown: only that a model is in use. */
export function getModels(user: Who, tags: SettingsModelTags) {
  needReader(user);
  return {
    items: MODEL_ROWS.map(({ key, label }) => {
      const tag = tags[key]?.trim() || null;
      if (!tag) return { key, label, tag: null, status: "not_set_up" as const };
      return { key, label, tag: /:\/\/|@|\s/.test(tag) ? null : tag, status: "in_use" as const };
    }),
  };
}

export type IntegrationStatus = "connected" | "simulated" | "not_set_up";
export interface IntegrationStates {
  email?: IntegrationStatus;
  registry?: IntegrationStatus;
  documents?: IntegrationStatus;
  models?: IntegrationStatus;
}
const INTEGRATION_ROWS: readonly { key: keyof IntegrationStates; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "registry", label: "Registry (Oqood)" },
  { key: "documents", label: "Document storage" },
  { key: "models", label: "Local AI models" },
];

/** A status per integration and nothing else: no address, host or key, whatever the engine is configured with. */
export function getIntegrations(user: Who, states: IntegrationStates) {
  needReader(user);
  return {
    items: INTEGRATION_ROWS.map(({ key, label }) => ({ key, label, status: states[key] ?? ("not_set_up" as const) })),
  };
}

// ---------------------------------------------------------------------------------------------
// The demo clock

const DEMO_CLOCK_SETTINGS = { kind: "settings" as const, id: "00000000-0000-7000-8000-000000000040" };
const DAY_MS = 86_400_000;
const ClockBody = z.union([
  z.strictObject({ days: z.number().int().min(1).max(365) }),
  z.strictObject({ rewind: z.literal(true) }),
]);

/** Sets the demo date N days ahead of today, or back to today. Not there outside demo mode, whoever asks. */
export async function setDemoClock(
  ctx: SpaContext,
  clock: SpaDemoClock,
  demoMode: boolean,
  user: Who,
  body: unknown,
): Promise<{ today: string; offsetDays: number; demo: true }> {
  if (!demoMode) throw notFound("page");
  needAdmin(user);
  const p = ClockBody.safeParse(body);
  if (!p.success) throw unprocessable("invalid_request", "send a number of days from 1 to 365, or rewind");
  const days = "days" in p.data ? p.data.days : 0;
  await withSpaTx(ctx.database, async (tx) => {
    const [row] = await tx.db.select().from(spaDemoSettings).where(eq(spaDemoSettings.id, 1)).for("update");
    const at = ctx.clock.now();
    await tx.db
      .insert(spaDemoSettings)
      .values({ id: 1, clockOffsetMs: days * DAY_MS, updatedAt: at })
      .onConflictDoUpdate({ target: spaDemoSettings.id, set: { clockOffsetMs: days * DAY_MS, updatedAt: at } });
    await appendDealEvent(tx, ctx, {
      entity: DEMO_CLOCK_SETTINGS,
      type: "DEMO_CLOCK_SET",
      actor: `user:${user.id}`,
      payload: { days, rewind: !("days" in p.data), previousDays: Math.round((row?.clockOffsetMs ?? 0) / DAY_MS) },
    });
  });
  await clock.refresh();
  return { today: clock.today(), offsetDays: clock.offsetDays, demo: true };
}
