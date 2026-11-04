import {
  type Actor,
  applyKycOps,
  fieldAliases,
  findField,
  formatAed,
  KycOp,
  KycOpError,
  newId,
  PropertyCategory,
  PropertySubtype,
  type StaffRole,
  type StaffUser,
} from "@leasing/core";
import {
  companies,
  contractRules,
  copilotMessages,
  copilotProposals,
  copilotThreads,
  rentRules,
  type Tx,
  withTx,
} from "@leasing/db";
import { normalizeWs } from "@leasing/helpers";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { forbidden, notFound, unprocessable } from "../errors.ts";
import { addCompanyClause } from "./contract-templates.ts";
import { appendEvent } from "./events.ts";
import { createContractRule, createRentRule, replaceContractRule, replaceRentRule } from "./portfolio.ts";
import { saveSriValue } from "./sri-values.ts";
import {
  companyKycConfig,
  kycDraft,
  lockKycConfig,
  publishKycDraft,
  saveKycDraft,
  validateKycConfig,
} from "./kyc-config.ts";
import { PROPOSAL_TTL_MS, proposalView } from "./copilot-proposals.ts";

/**
 * Contract and rent config the copilot may change (decision D45): a clause, a rent rule, a contract rule, a Smart
 * Rental Index value. `company` is a company name or slug.
 */
export const ConfigChange = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("add_clause"),
    company: z.string().trim().min(2).max(120),
    title: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(1200),
    ruleIds: z.array(z.uuid()).max(20).optional(),
  }),
  z.object({
    kind: z.literal("rent_rule"),
    company: z.string().trim().min(2).max(120),
    category: PropertyCategory,
    subtype: PropertySubtype.nullable().optional(),
    community: z.string().trim().min(1).max(120).nullable().optional(),
    minPctBp: z.number().int().min(-5000).max(5000),
    maxPctBp: z.number().int().min(-5000).max(5000),
    minRentFils: z.number().int().min(0).nullable().optional(),
    maxRentFils: z.number().int().min(0).nullable().optional(),
    replaceRuleId: z.uuid().optional(),
  }),
  z.object({
    kind: z.literal("contract_rule"),
    company: z.string().trim().min(2).max(120),
    category: PropertyCategory,
    subtype: PropertySubtype.nullable().optional(),
    tenures: z.array(z.enum(["annual", "short_term"])).min(1),
    minCheques: z.number().int().min(1).max(12),
    maxCheques: z.number().int().min(1).max(12),
    replaceRuleId: z.uuid().optional(),
  }),
  z.object({
    kind: z.literal("sri_value"),
    community: z.string().trim().min(1).max(120),
    bedrooms: z.number().int().min(0).max(10),
    avgAnnualRentFils: z.number().int().positive().max(100_000_000_00),
  }),
  // D50: edits to the company's document form and KYC rules, applied to its draft (publish only when asked).
  z.object({
    kind: z.literal("kyc_config"),
    company: z.string().trim().min(2).max(120),
    ops: z.array(KycOp).min(1).max(20),
  }),
]);
export type ConfigChange = z.infer<typeof ConfigChange>;

/** Same roles as the settings routes: admins change rules and clauses; admins and leasing managers the SRI table. */
const ROLES: Record<ConfigChange["kind"], StaffRole[]> = {
  add_clause: ["admin"],
  rent_rule: ["admin"],
  contract_rule: ["admin"],
  sri_value: ["admin", "leasing_manager"],
  kyc_config: ["admin"],
};
export function requireConfigRole(user: StaffUser, kind: ConfigChange["kind"]) {
  if (!ROLES[kind].includes(user.role)) throw forbidden(`${user.role} can't change this setting`);
}

async function companyId(tx: Tx, ref: string): Promise<string> {
  const [c] = await tx.db
    .select({ id: companies.id })
    .from(companies)
    .where(or(eq(companies.slug, ref.toLowerCase()), eq(companies.name, ref)));
  if (c) return c.id;
  const all = await tx.db.select({ id: companies.id, name: companies.name }).from(companies);
  const hits = all.filter((x) => x.name.toLowerCase().includes(ref.toLowerCase()));
  if (hits.length !== 1) throw notFound("company");
  return hits[0]!.id;
}

const pct = (bp: number) => `${bp > 0 ? "+" : ""}${bp / 100}%`;
const aed = (fils: number | null | undefined) => (fils === null || fils === undefined ? null : formatAed(fils));

/** What a suggested change would do, as label/value lines for the Confirm card (values formatted here, not by a model). */
export function changeFacts(change: ConfigChange): [string, string][] {
  if (change.kind === "kyc_config") return change.ops.map((op, i) => [`Change ${i + 1}`, describeKycOp(op)]);
  const rows: [string, string | null | undefined][] =
    change.kind === "add_clause"
      ? [
          ["Title", change.title],
          ["Wording", change.text],
          ["Added to", change.ruleIds?.length ? `${change.ruleIds.length} contract rule(s)` : "Additional clauses"],
        ]
      : change.kind === "rent_rule"
        ? [
            ["Category", change.category],
            ["Type", change.subtype ?? "All types"],
            ["Area", change.community ?? "All areas"],
            ["Band", `SRI ${pct(change.minPctBp)} to ${pct(change.maxPctBp)}`],
            ["Lowest rent", aed(change.minRentFils)],
            ["Highest rent", aed(change.maxRentFils)],
            ["Replaces", change.replaceRuleId ? "The current rule" : null],
          ]
        : change.kind === "contract_rule"
          ? [
              ["Category", change.category],
              ["Type", change.subtype ?? "All types"],
              ["Tenures", change.tenures.map((t) => (t === "annual" ? "Annual" : "Short term")).join(", ")],
              ["Cheques", `${change.minCheques} to ${change.maxCheques}`],
              ["Replaces", change.replaceRuleId ? "The current rule" : null],
            ]
          : [
              ["Area", change.community],
              ["Bedrooms", change.bedrooms === 0 ? "Studio" : String(change.bedrooms)],
              ["Average annual rent", formatAed(change.avgAnnualRentFils)],
            ];
  return rows.filter((r): r is [string, string] => typeof r[1] === "string");
}

const SEVERITY_WORD = { off: "Off", warning: "Warning", blocker: "Blocker" } as const;

const yesNo = (b: boolean | undefined, yes: string, no: string) => (b === undefined ? null : b ? yes : no);
const parts = (...xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(", ");

/** One KYC edit in plain words for the Confirm card, with every value it sets. */
export function describeKycOp(op: KycOp): string {
  switch (op.op) {
    case "set_check":
      return `${op.field}: "${op.check}" → ${parts(op.severity && SEVERITY_WORD[op.severity], yesNo(op.emailApplicant, "email applicant", "no email"))}`;
    case "set_number":
      return `${op.field}: ${op.setting.replaceAll("_", " ")} → ${op.value}`;
    case "set_name_match":
      return `Applicant's name must match: ${op.mode}`;
    case "add_document_field":
      return `Add document "${op.label}" (${parts(
        op.category === "custom" ? `custom: ${op.customName ?? op.label}` : op.category.replaceAll("_", " "),
        op.customDescription && `described as "${op.customDescription}"`,
        op.category === "custom" && (op.hasExpiry === false ? "no expiry date" : "has an expiry date"),
        op.required ? "required" : "optional",
        `shown to ${op.shownTo}`,
        op.help && `help "${op.help}"`,
      )})`;
    case "add_question_field":
      return `Add question "${op.label}" (${parts(
        op.type,
        op.required ? "required" : "optional",
        `shown to ${op.shownTo}`,
        !!op.options?.length && `choices: ${op.options.join(" / ")}`,
        op.help && `help "${op.help}"`,
      )})`;
    case "update_field":
      return `Change field "${op.field}": ${parts(
        op.label && `label "${op.label}"`,
        yesNo(op.required, "required", "optional"),
        op.shownTo && `shown to ${op.shownTo}`,
        op.help !== undefined && `help "${op.help}"`,
      )}`;
    case "add_rule": {
      const r = op.rule;
      return `Add custom check "${String(r.label ?? "")}" (${parts(
        String(r.type ?? ""),
        typeof r.severity === "string" ? SEVERITY_WORD[r.severity as keyof typeof SEVERITY_WORD] : "Warning",
        r.emailApplicant === true && "emails the applicant",
        typeof r.years === "number" && `${r.years} years`,
        typeof r.pattern === "string" && `pattern ${r.pattern}`,
        typeof r.instruction === "string" && `"${r.instruction}"`,
        Array.isArray(r.allowed) && r.allowed.length > 0 && `accepts ${r.allowed.join(" / ")}`,
      )})`;
    }
    case "set_rule":
      return `Custom check "${op.rule}" → ${parts(op.severity && SEVERITY_WORD[op.severity], yesNo(op.emailApplicant, "email applicant", "no email"))}`;
    case "remove_rule":
      return `Remove custom check "${op.rule}"`;
    case "remove_field":
      return `Remove field "${op.field}"`;
    case "publish":
      return "Publish the whole draft (new uploads use it)";
  }
}

/** Applies a change through the same managers (and validation) the settings forms use. */
export async function applyConfigChange(
  ctx: EngineContext,
  tx: Tx,
  user: StaffUser,
  change: ConfigChange,
  actor: Actor,
  valuesConfirmed: boolean,
) {
  requireConfigRole(user, change.kind);
  switch (change.kind) {
    case "add_clause": {
      const cid = await companyId(tx, change.company);
      const row = await addCompanyClause(
        ctx,
        tx,
        cid,
        {
          title: change.title,
          text: change.text,
          ruleIds: change.ruleIds,
          ...(valuesConfirmed ? { confirmValues: true } : {}),
        },
        actor,
      );
      return { id: row.id, entity: { kind: "company" as const, id: cid }, summary: `Clause "${row.title}" added` };
    }
    case "rent_rule": {
      const { kind: _k, company, replaceRuleId, ...v } = change;
      const cid = await companyId(tx, company);
      const values = { ...v, emirate: "dubai" };
      if (replaceRuleId) {
        const [old] = await tx.db.select().from(rentRules).where(eq(rentRules.id, replaceRuleId));
        if (old?.companyId !== cid) throw unprocessable("That rent rule is not this company's.", [], "bad_rule");
      }
      const row = replaceRuleId
        ? await replaceRentRule(ctx, tx, replaceRuleId, values, actor)
        : await createRentRule(ctx, tx, { ...values, companyId: cid }, actor);
      return { id: row.id, entity: { kind: "company" as const, id: cid }, summary: "Rent rule saved" };
    }
    case "contract_rule": {
      const { kind: _k, company, replaceRuleId, ...v } = change;
      const cid = await companyId(tx, company);
      let clauseIds: string[] = [];
      let sampleDocumentId: string | null = null;
      if (replaceRuleId) {
        const [old] = await tx.db.select().from(contractRules).where(eq(contractRules.id, replaceRuleId));
        if (old?.companyId !== cid) throw unprocessable("That contract rule is not this company's.", [], "bad_rule");
        clauseIds = old.clauseIds;
        sampleDocumentId = old.sampleDocumentId;
      }
      const row = replaceRuleId
        ? await replaceContractRule(ctx, tx, replaceRuleId, { ...v, clauseIds, sampleDocumentId }, actor)
        : await createContractRule(ctx, tx, { ...v, clauseIds, companyId: cid }, actor);
      return { id: row.id, entity: { kind: "company" as const, id: cid }, summary: "Contract rule saved" };
    }
    case "kyc_config": {
      const cid = await companyId(tx, change.company);
      // Lock first so a concurrent edit (another turn, the settings page) can't be overwritten by this one.
      await lockKycConfig(tx, cid);
      // Edits land in the draft (a copy of the live version when none is open); publishing is its own step.
      const start = (await kycDraft(tx, cid)) ?? (await companyKycConfig(tx, cid, ctx.clock.today()));
      let next: ReturnType<typeof applyKycOps>;
      try {
        next = applyKycOps({ form: start.form, rules: start.rules }, change.ops);
      } catch (e) {
        if (e instanceof KycOpError) throw unprocessable(e.message, [], "bad_kyc_change");
        throw e;
      }
      const draft = await saveKycDraft(ctx, tx, cid, { form: next.form, rules: next.rules }, actor, change.ops);
      const done = next.publish ? await publishKycDraft(ctx, tx, cid, actor) : null;
      return {
        id: String(draft.version),
        entity: { kind: "company" as const, id: cid },
        summary: done ? `KYC settings published as version ${done.version}` : `KYC draft v${draft.version} saved`,
      };
    }
    case "sri_value": {
      const { kind: _k, ...v } = change;
      const row = await saveSriValue(ctx, tx, v, actor);
      return {
        id: row.id,
        entity: { kind: "rulebook" as const, id: row.id },
        summary: "Smart Rental Index value saved",
      };
    }
  }
}

const norm = (s: string) => normalizeWs(s).toLowerCase();

/** Every number written in a message, as values: "105k" → 105000, "10,000" → 10000, "-3%" → 3 (sign dropped). */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k)?(?![\d])/gi)) {
    const n = Number(`${m[1]!.replaceAll(",", "")}${m[2] ? `.${m[2]}` : ""}`);
    out.add(m[3] ? n * 1000 : n);
  }
  return out;
}

/**
 * The values of an explicit change that the user's message does not contain (D45): a change is made directly only
 * when its numbers (and a clause's wording) are the user's own. Anything else must go through a suggestion.
 */
export function valuesNotSaid(
  change: ConfigChange,
  message: string,
  /** KYC: other names the field an edit refers to is known by (label, key, category words), for the field check. */
  fieldNames: (ref: string) => string[] = (ref) => [ref],
): string[] {
  const said = numbersIn(message);
  // The company (and an area) the change is for must be named by the user too.
  const named = (label: string, v: string | null | undefined) => (!v || norm(message).includes(norm(v)) ? [] : [label]);
  const who = "company" in change ? named("company", change.company) : [];
  const need = (label: string, n: number | null | undefined) =>
    n === null || n === undefined || said.has(n) ? [] : [label];
  // Which units a rule covers is the user's choice too: the category, a type, and a contract rule's tenures.
  const scope = (c: { category: string; subtype?: string | null | undefined }) => [
    ...named("category", c.category),
    ...named("type", c.subtype?.replaceAll("_", " ")),
  ];
  switch (change.kind) {
    case "add_clause":
      return [...who, ...(norm(message).includes(norm(change.text)) ? [] : ["clause wording"])];
    case "rent_rule":
      return [
        ...who,
        ...scope(change),
        ...named("area", change.community),
        ...need("lowest percent", Math.abs(change.minPctBp) / 100),
        ...need("highest percent", Math.abs(change.maxPctBp) / 100),
        ...need("lowest rent", typeof change.minRentFils === "number" ? change.minRentFils / 100 : null),
        ...need("highest rent", typeof change.maxRentFils === "number" ? change.maxRentFils / 100 : null),
      ];
    case "contract_rule":
      return [
        ...who,
        ...scope(change),
        ...change.tenures.flatMap((t) => named("tenure", t === "annual" ? "annual" : "short")),
        ...need("fewest cheques", change.minCheques),
        ...need("most cheques", change.maxCheques),
      ];
    case "kyc_config":
      return [...who, ...change.ops.flatMap((op) => kycValuesNotSaid(op, message, said, fieldNames))];
    case "sri_value":
      return [
        ...named("community", change.community),
        ...need("average rent", change.avgAnnualRentFils / 100),
        ...(change.bedrooms === 0 ? [] : need("bedrooms", change.bedrooms)),
      ];
  }
}

/** Words that must appear for a severity to be the user's choice (only tightening severities can be explicit). */
const SEVERITY_SAID: Record<string, RegExp> = { blocker: /\bblock(er|ing|s)?\b/i, warning: /\bwarn(ing|s)?\b/i };
/** "don't publish", "do not block", "not yet": a negation never authorises a change. */
const NEGATED = /\b(don'?t|do not|not|never|no need to|stop)\b[^.;!?]{0,30}\b(publish|block|remove|delete|live)/i;

/**
 * Why a KYC edit can't be made directly (D50): it is applied without a Confirm click only when it tightens or adds,
 * names its field, and every number, severity, "email", new wording and "publish" is in the user's own message.
 * Anything that loosens KYC (a check off or down to warning, a document optional or shown to fewer applicants, a
 * removal, no expiry date, a check that emails applicants) always goes through a suggestion the user confirms.
 */
function kycValuesNotSaid(
  op: KycOp,
  message: string,
  said: Set<number>,
  fieldNames: (ref: string) => string[],
): string[] {
  const has = (re: RegExp) => re.test(message);
  const text = (label: string, v: string | undefined) => (!v || norm(message).includes(norm(v)) ? [] : [label]);
  // The field counts as named when the message uses any name it is known by ("passport" for "Passport data page").
  const field = (ref: string) =>
    fieldNames(ref).some((n) => n.length >= 3 && norm(message).includes(norm(n))) ? [] : [`which field ("${ref}")`];
  const sev = (s: string | undefined) =>
    !s
      ? []
      : s === "off"
        ? ["turning a check off (needs Confirm)"]
        : SEVERITY_SAID[s]!.test(message)
          ? []
          : [`severity ${s}`];
  const mail = (e: boolean | undefined) => (e === undefined || has(/\be-?mail/i) ? [] : ["email applicant"]);
  if (has(NEGATED)) return ["a negated request (needs Confirm)"];
  switch (op.op) {
    case "set_check":
      return [
        ...(op.severity === "warning" ? ["lowering a check to warning (needs Confirm)"] : []),
        ...(op.severity === undefined && op.emailApplicant === undefined ? ["no change named"] : []),
        ...(op.emailApplicant === false ? ["stopping applicant emails (needs Confirm)"] : []),
        ...(norm(op.field) === "across documents" ? [] : field(op.field)),
        ...sev(op.severity === "warning" ? undefined : op.severity),
        ...mail(op.emailApplicant),
      ];
    case "set_rule":
      return [
        ...(op.severity === "warning" || op.severity === "off" ? ["lowering a custom check (needs Confirm)"] : []),
        ...(op.emailApplicant === false ? ["stopping applicant emails (needs Confirm)"] : []),
        ...text(`which custom check ("${op.rule}")`, op.rule),
        ...sev(op.severity === "blocker" ? "blocker" : undefined),
        ...mail(op.emailApplicant),
      ];
    case "set_number":
      return [...field(op.field), ...(said.has(op.value) ? [] : [op.setting.replaceAll("_", " ")])];
    case "set_name_match":
      return op.mode === "exact" && has(/\bexact/i) ? [] : ["name match (lenient needs Confirm)"];
    case "add_document_field":
      return [
        ...text("field label", op.label),
        ...text("document name", op.customName),
        ...text("document description", op.customDescription),
        ...text("help text", op.help),
        ...(op.hasExpiry === false ? ["a document without an expiry date (needs Confirm)"] : []),
        ...(op.required === false ? ["an optional document (needs Confirm)"] : []),
      ];
    case "add_question_field":
      return [
        ...text("field label", op.label),
        ...text("help text", op.help),
        ...(op.options ?? []).flatMap((o) => text(`choice "${o}"`, o)),
      ];
    case "update_field":
      return [
        ...field(op.field),
        ...text("new label", op.label),
        ...text("help text", op.help),
        ...(op.required === false ? ["making a field optional (needs Confirm)"] : []),
        ...(op.required === true && !has(/\b(required|mandatory|must)\b/i) ? ["required"] : []),
        ...(op.shownTo !== undefined ? ["who sees a field (needs Confirm)"] : []),
      ];
    case "add_rule": {
      const r = op.rule;
      const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
      return [
        ...text("check label", str("label")),
        ...text("instruction", str("instruction")),
        ...text("pattern", str("pattern")),
        ...text("plain words", str("describe")),
        ...(Array.isArray(r.allowed)
          ? r.allowed.flatMap((x) => text(`accepted answer "${String(x)}"`, String(x)))
          : []),
        ...(typeof r.years === "number" && !said.has(r.years) ? ["years"] : []),
        ...(r.emailApplicant === true ? ["a check that emails applicants (needs Confirm)"] : []),
        ...(r.severity === "off"
          ? ["a check that is off"]
          : sev(str("severity") === "blocker" ? "blocker" : undefined)),
      ];
    }
    case "remove_field":
    case "remove_rule":
      return ["removing a field or check (needs Confirm)"];
    case "publish":
      return has(/\b(publish|go live|make (it )?live)\b/i) ? [] : ["publish"];
  }
}

/**
 * An explicit change: the user asked for it in their own words. `userQuote` must be at least 8 characters of the
 * user's latest message in this conversation (their own words, never tool output or tenant text), else 422.
 */
export async function explicitConfigChange(
  ctx: EngineContext,
  user: StaffUser,
  threadId: string,
  userQuote: string,
  raw: unknown,
) {
  const change = ConfigChange.parse(raw);
  requireConfigRole(user, change.kind);
  return withTx(ctx.database, async (tx) => {
    const [thread] = await tx.db
      .select({ id: copilotThreads.id })
      .from(copilotThreads)
      .where(and(eq(copilotThreads.id, threadId), eq(copilotThreads.userId, user.id)));
    if (!thread) throw notFound("conversation");
    const [last] = await tx.db
      .select()
      .from(copilotMessages)
      .where(and(eq(copilotMessages.threadId, threadId), eq(copilotMessages.role, "user")))
      .orderBy(desc(copilotMessages.at), desc(copilotMessages.id))
      .limit(1);
    const quote = norm(userQuote);
    let fieldNames: ((ref: string) => string[]) | undefined;
    if (change.kind === "kyc_config") {
      const cid = await companyId(tx, change.company);
      const cfg = (await kycDraft(tx, cid)) ?? (await companyKycConfig(tx, cid, ctx.clock.today()));
      fieldNames = (ref) => {
        try {
          return [ref, ...fieldAliases(findField(cfg.form, ref))];
        } catch {
          return [ref];
        }
      };
    }
    const missing = last ? valuesNotSaid(change, last.content, fieldNames) : [];
    if (!last || quote.length < 8 || !norm(last.content).includes(quote) || missing.length) {
      throw unprocessable(
        "A setting is changed directly only when your own latest message asks for it with these values. Use a suggestion the user confirms instead.",
        missing,
        "not_your_words",
      );
    }
    const actor = `copilot:${user.id}` as const;
    // The clause wording, amounts included, is the user's own (checked above).
    const valuesConfirmed = true;
    const done = await applyConfigChange(ctx, tx, user, change, actor, valuesConfirmed);
    await appendEvent(tx, ctx, {
      entity: done.entity,
      type: "COPILOT_CONFIG_CHANGED",
      actor,
      payload: { kind: change.kind, id: done.id, userQuote, messageId: last.id, threadId },
      rulesVersion: ctx.rulesVersion,
    });
    return { status: "done" as const, kind: change.kind, id: done.id, summary: done.summary };
  });
}

/** A suggested change: stored as a proposal; only the user's Confirm click applies it. */
export async function proposeConfigChange(ctx: EngineContext, user: StaffUser, threadId: string, raw: unknown) {
  const change = ConfigChange.parse((raw as { change?: unknown }).change);
  requireConfigRole(user, change.kind);
  return withTx(ctx.database, async (tx) => {
    const [thread] = await tx.db
      .select({ id: copilotThreads.id })
      .from(copilotThreads)
      .where(and(eq(copilotThreads.id, threadId), eq(copilotThreads.userId, user.id)));
    if (!thread) throw notFound("conversation");
    // A KYC edit is tried on the current draft now, so a wrong field or check comes back to the copilot to fix
    // instead of failing on Confirm.
    if (change.kind === "kyc_config") {
      const cid = await companyId(tx, change.company);
      const start = (await kycDraft(tx, cid)) ?? (await companyKycConfig(tx, cid, ctx.clock.today()));
      try {
        validateKycConfig(applyKycOps({ form: start.form, rules: start.rules }, change.ops));
      } catch (e) {
        if (e instanceof KycOpError) throw unprocessable(e.message, [], "bad_kyc_change");
        throw e;
      }
    }
    let company: string | null = null;
    if (change.kind !== "sri_value") {
      const id = await companyId(tx, change.company);
      const [c] = await tx.db.select({ name: companies.name }).from(companies).where(eq(companies.id, id));
      company = c!.name;
    }
    const now = ctx.clock.now();
    const [row] = await tx.db
      .insert(copilotProposals)
      .values({
        id: newId(),
        threadId,
        userId: user.id,
        kind: "config_change",
        payload: { change },
        summary: { change: change.kind, company, facts: changeFacts(change) },
        expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
        createdAt: now,
      })
      .returning();
    return proposalView(row!, now.getTime());
  });
}
