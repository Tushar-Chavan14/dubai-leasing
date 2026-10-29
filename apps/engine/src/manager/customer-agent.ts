import { randomBytes } from "node:crypto";
import {
  addDays,
  type CompanyPolicy,
  type ChannelReply,
  type ChatFilters,
  type ChoiceItem,
  type EnquiryFlow,
  type EnquiryLanguage,
  formatAed,
  maskPiiText,
  newId,
  PropertyCategory,
  toDubaiDate,
} from "@leasing/core";
import {
  applications,
  companies,
  conversations,
  leaseEvents,
  messages,
  parties,
  sriAverages,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import {
  type AgentBackend,
  type AgentContext,
  type AgentModel,
  type AgentData,
  CustomerAgentSchemas,
  customerAgent,
  enquiryCopy,
  formatSlot,
  type ToolOutcome,
  untrusted,
} from "@leasing/helpers";
import { and, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import {
  type ConvRow,
  CompanyName,
  Name,
  applyNow,
  book,
  chatFilters,
  compact,
  filtersOf,
  langOf,
  type Outcome,
  parseBudgetAed,
  selOf,
  startApply,
  type Sel,
  withoutApply,
  unitCards,
  webMenuButtons,
} from "./enquiries.ts";
import { listedCommunities, listedUnit, listedUnits, resolveCompany, takenViewings } from "./availability.ts";
import { getCompanyPolicy } from "./events.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { freeViewingSlots } from "./viewing-slots.ts";
import { hasStatusSession, maskEmail, startCode, statusFor } from "./web-chat-status.ts";
import { isStatusStandIn, type RunRecord } from "@leasing/helpers";

/**
 * The web chat's customer agent (decision D36), engine side. The helper (`@leasing/helpers`
 * customer-agent) is the model loop; this file is its tools. Each tool runs as the conversation:
 * its own contact email, its own chat. Nothing a tool takes from the model is trusted: unit ids
 * must be ones the visitor was shown (or a tool returned this turn), slots must be ones
 * `viewing_slots` returned this turn and must still be free under the unit lock, choice values must
 * be tool-issued, and a tap on a choice card comes back as `pick:<id>:<n>`, resolved from the
 * flow's stored choices (never a raw value). Bookings and applications go through the same
 * Manager functions as the buttons, with the same limits (one open application per unit, three
 * open web applications per email).
 */

const MAX_HISTORY = 10;
const AGENT_DEADLINE_MS = 60_000;
const AGENT_MAX_CONCURRENT = 2;
/** Agent turns running now in this process. */
let activeTurns = 0;
const MAX_SLOTS = 6;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Dubai is UTC+4 all year. */
const DUBAI_MS = 4 * 3_600_000;

function toolError(message: string): never {
  throw new Error(message);
}

/** Dubai wall-clock ISO with offset, e.g. 2026-11-03T10:00:00+04:00. */
const dubaiIso = (d: Date) => `${new Date(d.getTime() + DUBAI_MS).toISOString().slice(0, 19)}+04:00`;
const dubaiHour = (d: Date) => new Date(d.getTime() + DUBAI_MS).getUTCHours();

/** Arabic when the text is mostly Arabic; English when it is clearly Latin; else the chat's current language. */
export function detectLanguage(text: string, current: EnquiryLanguage): EnquiryLanguage {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 3) return current;
  const arabic = text.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  if (arabic / letters >= 0.3) return "ar";
  return arabic === 0 && letters >= 6 ? "en" : current;
}

/** Words that show a message is a request or a reply to the agent, never a name or company. */
const INTENT_WORDS = new Set(
  [
    "no",
    "nope",
    "nah",
    "yes",
    "yeah",
    "yep",
    "ok",
    "okay",
    "cancel",
    "stop",
    "book",
    "booking",
    "apply",
    "applying",
    "application",
    "viewing",
    "view",
    "thanks",
    "thank",
    "please",
    "never",
    "mind",
    "help",
    "hello",
    "hi",
    "hey",
    "what",
    "why",
    "how",
    "when",
    "which",
    "where",
    "who",
    "rent",
    "unit",
    "change",
    "back",
    "skip",
    "send",
    "show",
    "لا",
    "نعم",
    "إلغاء",
    "الغاء",
    "ألغ",
    "توقف",
    "حجز",
    "احجز",
    "معاينة",
    "تقديم",
    "قدم",
    "قدّم",
    "شكرا",
    "شكراً",
    "مساعدة",
    "مرحبا",
    "اهلا",
    "أهلا",
    "تخطي",
  ].map((w) => w.toLowerCase()),
);
/** Ordinals and "other": fine inside a company name ("First Gulf Trading"), not as a person's name. */
const CHOICE_WORDS = new Set(
  [
    "first",
    "second",
    "third",
    "fourth",
    "last",
    "other",
    "another",
    "instead",
    "one",
    "ones",
    "this",
    "that",
    "الأول",
    "الاول",
    "الثاني",
    "الثالث",
    "الأخير",
    "آخر",
    "اخرى",
    "أخرى",
    "بدلا",
    "بدلاً",
    "هذا",
    "هذه",
  ].map((w) => w.toLowerCase()),
);
const tokensOf = (text: string) =>
  text
    .trim()
    .split(/\s+/)
    .map((t) => t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

/**
 * A person's name typed at "what is your name?": one to four tokens of letters (any script) with
 * ' - . allowed, no digits, and no intent word ("no thanks", "cancel", "the second one"). Anything
 * else goes to the agent instead of being saved as a name.
 */
export function plausibleName(text: string): boolean {
  const t = text.trim();
  if (!Name.safeParse(t).success || /\d/.test(t)) return false;
  const tokens = tokensOf(t);
  return (
    tokens.length >= 1 &&
    tokens.length <= 4 &&
    !tokens.some((w) => INTENT_WORDS.has(w) || CHOICE_WORDS.has(w) || w === "the")
  );
}

/** A company name at "what is your company's name?": the CompanyName rule, and not a request. */
export function plausibleCompany(text: string): boolean {
  const t = text.trim();
  if (!CompanyName.safeParse(t).success) return false;
  const tokens = tokensOf(t);
  if (tokens.length === 0 || tokens.length > 8) return false;
  // A longer legal name may contain a common word; a short reply that is one is not a company.
  return !(tokens.length <= 3 ? tokens.some((w) => INTENT_WORDS.has(w)) : INTENT_WORDS.has(tokens[0]!));
}

/** Free text at a step that asks for a typed answer: true when it is plausibly that answer (so code saves it). */
export function answersStepQuestion(step: string, text: string): boolean {
  if (step === "asking_name") return plausibleName(text);
  if (step === "asking_company_name") return plausibleCompany(text);
  if (step === "asking_email") return /^\S+@\S+\.\S+$/.test(text.trim());
  return false;
}

const UNIT_TERMINAL = new Set([
  "booked",
  "viewing_requested",
  "already_booked",
  "already_open",
  "too_many_applications",
]);
const APPLY_TERMINAL = new Set([
  "applied",
  "already_booked",
  "already_applied",
  "already_open",
  "too_many_applications",
  "apply_unavailable",
  "ask_company_name",
  "ask_name",
]);

export interface AgentBackendOptions {
  ctx: EngineContext;
  conversationId: string;
  /** The flow as the turn started; tools extend it and the engine applies the result at the end. */
  flow: EnquiryFlow;
  language: EnquiryLanguage;
  /** The visitor's message (masked): a budget in it is read by code. */
  text: string;
  /** Takes one status-code request from the client's per-IP budget; false = over the limit. */
  codeQuota?: (() => boolean) | undefined;
}

/** The tools. One instance per visitor message. */
export class WebAgentBackend implements AgentBackend {
  private flow: EnquiryFlow;
  private cancelled = false;
  private readonly issuedUnits = new Set<string>();
  private readonly issuedSlots = new Map<string, Set<number>>();
  private readonly lang: EnquiryLanguage;
  constructor(private readonly o: AgentBackendOptions) {
    this.flow = o.flow;
    this.lang = o.language;
  }

  /** The turn's deadline passed: tools that haven't started yet refuse to run. */
  cancel() {
    this.cancelled = true;
  }

  private get t() {
    return enquiryCopy[this.lang];
  }

  private run<T>(fn: (tx: Tx, conv: ConvRow, policy: CompanyPolicy) => Promise<T>, lock = false): Promise<T> {
    const { ctx, conversationId } = this.o;
    if (this.cancelled) return Promise.reject(new Error("the turn has timed out"));
    return withTx(ctx.database, async (tx) => {
      const q = tx.db.select().from(conversations).where(eq(conversations.id, conversationId));
      const [row] = lock ? await q.for("update") : await q;
      if (!row) throw notFound("conversation");
      // The deadline may have passed while this waited for the lock: nothing is written after the error reply went out.
      if (this.cancelled) throw new Error("the turn has timed out");
      const policy = await getCompanyPolicy(tx, ctx.clock.today());
      // The tools' flow, not the stored one: earlier tools in this message have moved it.
      return fn(tx, { ...row, flow: this.flow, language: this.lang }, policy);
    });
  }

  private setFlow(flow: EnquiryFlow): EnquiryFlow {
    this.flow = flow;
    return flow;
  }

  /** A unit the agent may act on: one this message's tools returned, or one the visitor was shown. */
  private unitId(raw: string): string {
    const known = this.issuedUnits.has(raw) || this.flow.shown?.includes(raw) === true || this.flow.unitId === raw;
    if (!known) toolError("that unit id was not returned by a tool for this visitor; call search_units first");
    return raw;
  }

  private issue(unitIds: string[]) {
    for (const id of unitIds) this.issuedUnits.add(id);
  }

  /** The visitor's name when code already holds one: typed earlier in this booking, or on their own earlier application. */
  private async knownName(tx: Tx, conv: ConvRow): Promise<string | undefined> {
    if (conv.flow.nameEn) return conv.flow.nameEn;
    if (!conv.applicationId || !conv.contactEmail) return undefined;
    const [row] = await tx.db
      .select({ name: parties.fullNameEn, kind: parties.kind, email: parties.email })
      .from(applications)
      .innerJoin(parties, eq(parties.id, applications.partyId))
      .where(eq(applications.id, conv.applicationId));
    return row && row.kind === "individual" && row.email?.toLowerCase() === conv.contactEmail ? row.name : undefined;
  }

  // ------------------------------------------------------------ reads

  async search_units(a: Parameters<AgentBackend["search_units"]>[0]): Promise<ToolOutcome> {
    return this.run(async (tx, _conv, policy) => {
      const today = this.o.ctx.clock.today();
      const sel: Sel = a.reset ? {} : selOf(this.flow);
      if (a.company) {
        const hit = await resolveCompany(tx, today, a.company);
        if (!hit.ok)
          toolError(
            hit.reason === "ambiguous"
              ? `more than one company matches; which one: ${hit.names.join("; ")}`
              : `unknown company; companies with listings: ${hit.names.join("; ")}`,
          );
        sel.companyId = hit.id;
      }
      if (a.community) {
        const known = await listedCommunities(tx, true);
        const hit = known.find((k) => k.toLowerCase() === a.community!.trim().toLowerCase());
        if (!hit) toolError(`unknown area; areas with homes: ${known.join("; ")}`);
        sel.community = hit;
      }
      if (a.category) sel.category = a.category;
      else if (a.bedrooms !== undefined && !sel.category) sel.category = "residential";
      if (a.bedrooms !== undefined) sel.bedrooms = a.bedrooms;
      if (a.sizeBand) sel.sizeBand = a.sizeBand;
      // A budget the visitor typed is read by code; the model's number is used only when the text has none.
      const typed = parseBudgetAed(this.o.text);
      const aed = typed ?? a.maxRentAed;
      if (aed !== undefined) sel.maxRentFils = aed * 100;
      if (sel.category && sel.category !== "residential") delete sel.bedrooms;
      if (sel.category === "residential" || !sel.category) delete sel.sizeBand;
      if (sel.sizeBand && !sel.category) sel.category = "commercial";
      sel.emirate = "dubai";

      // Every matching unit, so "how many" is answered with a real count; five are shown.
      const matching = (await listedUnits(tx, today, filtersOf(sel, true), 500)).filter(
        (u) => u.askingRentFils !== null,
      );
      let found = matching.slice(0, 5);
      let total = matching.length;
      // `agent_suggest_alternatives` (D37): when a unit the visitor was shown is taken, units of the same
      // company come first, then the rest of the search. Off: `similarTo` is ignored and the search is plain.
      let sameCompany = 0;
      if (a.similarTo && policy.autopilot.agent_suggest_alternatives) {
        const [gone] = await tx.db
          .select()
          .from(units)
          .where(eq(units.id, this.unitId(a.similarTo)));
        if (gone) {
          const like: Sel = { ...sel };
          if (like.bedrooms === undefined && gone.bedrooms !== null && gone.category === "residential")
            like.bedrooms = gone.bedrooms;
          if (!like.category) like.category = gone.category;
          const own = (await listedUnits(tx, today, filtersOf({ ...like, companyId: gone.companyId }, true))).filter(
            (u) => u.askingRentFils !== null && u.id !== gone.id,
          );
          const rest = (await listedUnits(tx, today, filtersOf(like, true))).filter(
            (u) => u.askingRentFils !== null && u.id !== gone.id,
          );
          const merged = [...own, ...rest.filter((u) => !own.some((o) => o.id === u.id))];
          sameCompany = own.length;
          found = merged.slice(0, 5);
          total = merged.length;
        }
      }
      const cards = await unitCards(tx, found, policy.autopilot.apply_without_viewing);
      const companyRows = sel.companyId
        ? await tx.db.select({ id: companies.id, name: companies.name }).from(companies)
        : [];
      const companyName = new Map(companyRows.map((k) => [k.id, k.name]));
      this.issue(found.map((u) => u.id));
      const flow = this.setFlow({
        step: "choosing_unit",
        ...compact(sel),
        ...(found.length ? { shown: found.map((u) => u.id) } : {}),
      });
      return {
        result: {
          count: found.length,
          total,
          filters: {
            community: sel.community ?? null,
            company: sel.companyId ? (companyName.get(sel.companyId) ?? null) : null,
            category: sel.category ?? null,
            bedrooms: sel.bedrooms ?? null,
            sizeBand: sel.sizeBand ?? null,
            maxRent: sel.maxRentFils ? formatAed(sel.maxRentFils) : null,
          },
          units: found.map((u) => ({
            unitId: u.id,
            choice: `unit:${u.id}`,
            code: u.code,
            building: u.building,
            community: u.community,
            company: companyName.get(u.companyId) ?? null,
            bedrooms: u.bedrooms,
            areaSqft: u.areaSqft,
            category: u.category,
            furnished: u.furnished ?? false,
            rentPerYear: formatAed(u.askingRentFils!),
          })),
          ...(sameCompany ? { sameCompanyFirst: sameCompany } : {}),
          ...(found.length ? {} : { note: "No bookable unit matches. Say so and offer a wider search." }),
        },
        effects: { cards, flow, kind: found.length ? "agent_results" : "no_results" },
      };
    });
  }

  async unit_details(a: Parameters<AgentBackend["unit_details"]>[0]): Promise<ToolOutcome> {
    return this.run(async (tx, _conv, policy) => {
      const id = this.unitId(a.unitId);
      const u = await listedUnit(tx, this.o.ctx.clock.today(), id, true);
      if (!u || u.askingRentFils === null) toolError(this.unavailable(policy));
      const unit = u!;
      this.issue([unit.id]);
      const canApply = policy.autopilot.apply_without_viewing;
      const flow = this.setFlow({
        ...withoutApply(this.flow),
        step: this.flow.step === "idle" ? "choosing_unit" : this.flow.step,
        unitId: unit.id,
        shown: [...new Set([unit.id, ...(this.flow.shown ?? [])])].slice(0, 5),
      });
      return {
        result: {
          unitId: unit.id,
          code: unit.code,
          building: unit.building,
          community: unit.community,
          category: unit.category,
          subtype: unit.subtype,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          areaSqft: unit.areaSqft,
          floor: unit.floor,
          parkingSpaces: unit.parkingSpaces,
          furnished: unit.furnished ?? false,
          rentPerYear: formatAed(unit.askingRentFils!),
          canApplyWithoutViewing: canApply,
          description: unit.description ? untrusted(unit.description.slice(0, 500)) : null,
        },
        effects: { cards: await unitCards(tx, [unit], canApply), flow },
      };
    });
  }

  async viewing_slots(a: Parameters<AgentBackend["viewing_slots"]>[0]): Promise<ToolOutcome> {
    return this.run(async (tx, _conv, policy) => {
      const { ctx } = this.o;
      const id = this.unitId(a.unitId);
      const unit = await listedUnit(tx, ctx.clock.today(), id, true);
      if (!unit) toolError(this.unavailable(policy));
      const free = freeViewingSlots(ctx.clock.now(), policy, await takenViewings(tx, id), 60);
      const today = ctx.clock.today();
      const wanted = free.filter((s) => {
        if (a.day && toDubaiDate(s) !== (a.day === "today" ? today : addDays(today, 1))) return false;
        const h = dubaiHour(s);
        return a.part === "morning"
          ? h < 12
          : a.part === "afternoon"
            ? h >= 12 && h < 17
            : a.part === "evening"
              ? h >= 17
              : true;
      });
      const shown = (wanted.length ? wanted : free).slice(0, MAX_SLOTS);
      const issued = this.issuedSlots.get(id) ?? new Set<number>();
      for (const s of shown) issued.add(s.getTime());
      this.issuedSlots.set(id, issued);
      this.issue([id]);
      const flow = this.setFlow({ ...withoutApply(this.flow), step: "choosing_slot", unitId: id });
      delete flow.slot;
      return {
        result: {
          unit: unit!.code,
          slots: shown.map((s) => ({
            slot: dubaiIso(s),
            time: formatSlot(s, this.lang),
            choice: `slot:${id}@${dubaiIso(s)}`,
          })),
          ...(shown.length === 0
            ? { note: "No free viewing times in the next few days." }
            : wanted.length || (!a.day && !a.part)
              ? {}
              : { note: "Nothing is free for that day or part of the day; these are the next free times." }),
        },
        effects: { flow },
      };
    });
  }

  /** The error for a unit that is gone; with `agent_suggest_alternatives` on it points at the alternatives search. */
  private unavailable(policy: CompanyPolicy): string {
    return policy.autopilot.agent_suggest_alternatives
      ? "that unit is no longer available. Tell the visitor, then call search_units with similarTo set to that unit id to find similar units (same company first)."
      : "that unit is no longer available";
  }

  /** Bookings and applications this chat's agent made today (Dubai day), counted from the audit trail. */
  private async actionsToday(tx: Tx, conv: ConvRow): Promise<number> {
    const [row] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(leaseEvents)
      .where(
        and(
          eq(leaseEvents.entityKind, "conversation"),
          eq(leaseEvents.entityId, conv.id),
          eq(leaseEvents.type, "AGENT_ACTION"),
          sql`${leaseEvents.payload}->>'on' = ${this.o.ctx.clock.today()}`,
        ),
      );
    return row?.n ?? 0;
  }

  /** The fixed reply when the day's cap is reached (the visitor can still tap the normal buttons). */
  private capReached(): ToolOutcome {
    return {
      result: { status: "daily_limit_reached" },
      final: this.t.agentDailyCap,
      effects: { buttons: webMenuButtons(this.lang), kind: "agent_daily_cap" },
    };
  }

  // ------------------------------------------------------------ actions

  async book_viewing(a: Parameters<AgentBackend["book_viewing"]>[0]): Promise<ToolOutcome> {
    const id = this.unitId(a.unitId);
    const at = new Date(a.slot);
    if (Number.isNaN(at.getTime()) || !this.issuedSlots.get(id)?.has(at.getTime()))
      toolError("that slot was not returned by viewing_slots for this unit in this message; call viewing_slots first");
    return this.run(async (tx, conv, policy) => {
      const email = conv.contactEmail;
      if (!email) toolError("the visitor's email is not on file yet");
      const t = this.t;
      // `agent_free_text_book` (D37): off, a typed request only offers the time as a button; the tap books it.
      if (!policy.autopilot.agent_free_text_book) {
        const choiceId = randomBytes(4).toString("hex");
        const next = this.setFlow({
          ...withoutApply(this.flow),
          step: "choosing_slot",
          unitId: id,
          choiceSet: { id: choiceId, items: [{ kind: "slot", unitId: id, slot: at.toISOString() }] },
        });
        return {
          result: { status: "needs_tap", note: "The visitor must tap the time to book it. Do not say it is booked." },
          final: t.agentTapToBook,
          effects: {
            buttons: [{ label: formatSlot(at, this.lang), data: `pick:${choiceId}:0` }],
            flow: next,
            kind: "needs_tap_book",
          },
        };
      }
      if ((await this.actionsToday(tx, conv)) >= policy.autopilot.agent_daily_action_cap) return this.capReached();
      if (!(await listedUnit(tx, this.o.ctx.clock.today(), id, true))) toolError(this.unavailable(policy));
      const name = await this.knownName(tx, conv);
      const flow: EnquiryFlow = { ...withoutApply(conv.flow), unitId: id, slot: at.toISOString(), agent: true };
      if (!name) {
        // The name is typed by the visitor and read by code; the next message completes the booking.
        const next = this.setFlow({ ...flow, step: "asking_name" });
        return {
          result: { need: "name", status: "asked the visitor for their full name" },
          final: t.askName,
          effects: { flow: next, kind: "ask_name" },
        };
      }
      const o = await book(this.o.ctx, tx, { ...conv, flow: { ...flow, nameEn: name } }, email!, policy);
      return this.fromOutcome(o, UNIT_TERMINAL);
    }, true);
  }

  async apply_now(a: Parameters<AgentBackend["apply_now"]>[0]): Promise<ToolOutcome> {
    const id = this.unitId(a.unitId);
    return this.run(async (tx, conv, policy) => {
      if (!conv.contactEmail) toolError("the visitor's email is not on file yet");
      // `agent_free_text_apply` (D37): off, a typed request only shows the Apply button; the tap starts it.
      if (policy.autopilot.apply_without_viewing && !policy.autopilot.agent_free_text_apply) {
        return {
          result: { status: "needs_tap", note: "The visitor must tap Apply. Do not say they applied." },
          final: this.t.agentTapToApply,
          effects: {
            buttons: [{ label: this.t.applyCta, data: `apply:${id}` }],
            kind: "needs_tap_apply",
          },
        };
      }
      if ((await this.actionsToday(tx, conv)) >= policy.autopilot.agent_daily_action_cap) return this.capReached();
      if (!(await listedUnit(tx, this.o.ctx.clock.today(), id, true))) toolError(this.unavailable(policy));
      const started = await startApply(this.o.ctx, tx, conv, id, policy);
      if (started.kind === "ask_name" && started.flow) {
        const name = await this.knownName(tx, conv);
        if (name) {
          const done = await applyNow(
            this.o.ctx,
            tx,
            { ...conv, flow: { ...started.flow, nameEn: name, agent: true } },
            conv.contactEmail!,
            policy,
          );
          return this.fromOutcome(done, APPLY_TERMINAL);
        }
      }
      // Asking for a name or company: the agent started it, so its completion counts toward the cap.
      return this.fromOutcome(
        started.flow ? { ...started, flow: { ...started.flow, agent: true } } : started,
        APPLY_TERMINAL,
      );
    }, true);
  }

  /** A Manager outcome as a tool result. Terminal kinds end the turn with the Manager's own (fixed) text. */
  private fromOutcome(o: Outcome, terminal: Set<string>): ToolOutcome {
    const text = o.reply?.text ?? "";
    if (o.flow) this.setFlow(o.flow);
    if (terminal.has(o.kind) && text) {
      return {
        result: { status: o.kind, message: text },
        final: text,
        effects: { ...(o.flow ? { flow: o.flow } : {}), kind: o.kind },
      };
    }
    return {
      result: {
        status: o.kind,
        message: text.split("\n")[0] ?? text,
        note: "Not done. Tell the visitor and offer the next step.",
      },
      ...(o.flow ? { effects: { flow: o.flow } } : {}),
    };
  }

  // ------------------------------------------------------------ rent index

  /**
   * `agent_sri_answers` (D37): the Smart Rental Index average for an area, read from the table and
   * formatted by code, so the model never states a figure of its own.
   */
  async area_rent_index(a: Parameters<AgentBackend["area_rent_index"]>[0]): Promise<ToolOutcome> {
    return this.run(async (tx, _conv, policy) => {
      if (!policy.autopilot.agent_sri_answers) toolError("rent index answers are switched off");
      const known = await listedCommunities(tx, true);
      const hit = known.find((k) => k.toLowerCase() === a.community.trim().toLowerCase());
      if (!hit) toolError(`unknown area; areas with homes: ${known.join("; ")}`);
      const category = a.category ?? "residential";
      const bedrooms = category === "residential" ? (a.bedrooms ?? null) : null;
      if (category === "residential" && bedrooms === null)
        toolError("say how many bedrooms (0 for a studio) for a home");
      const [row] = await tx.db
        .select()
        .from(sriAverages)
        .where(
          and(
            eq(sriAverages.community, hit!),
            eq(sriAverages.category, category),
            bedrooms === null ? sql`${sriAverages.bedrooms} is null` : eq(sriAverages.bedrooms, bedrooms),
            isNotNull(sriAverages.avgAnnualRentFils),
            lte(sriAverages.effectiveFrom, this.o.ctx.clock.today()),
          ),
        )
        .orderBy(desc(sriAverages.effectiveFrom))
        .limit(1);
      if (!row?.avgAnnualRentFils)
        return { result: { found: false, note: "There is no index figure for that. Say so; do not guess." } };
      const what = category === "residential" ? this.t.bedrooms(bedrooms!) : category;
      return {
        result: {
          found: true,
          area: hit,
          for: what,
          averageRentPerYear: formatAed(row.avgAnnualRentFils),
          from: row.effectiveFrom,
          note: "An index average for the area, not a price for any unit and not an offer.",
        },
      };
    });
  }

  // ------------------------------------------------------------ status

  async my_status(): Promise<ToolOutcome> {
    return this.run(async (tx, conv) => {
      if (!conv.contactEmail || !(await hasStatusSession(this.o.ctx, tx, conv)))
        toolError("the visitor's email is not verified; use start_status_check");
      const status = await statusFor(tx, conv.contactEmail!, this.o.ctx.clock.today(), this.lang);
      const apps = status.apps.map((s) => ({
        reference: s.ref,
        unit: s.unitCode,
        stage: s.stage,
        next: s.nextStep,
        ...(s.offer ? { offerRentPerYear: s.offer.annualRent, cheques: s.offer.cheques } : {}),
      }));
      return {
        result: { count: apps.length, applications: apps, ...(apps.length ? {} : { message: this.t.statusNone }) },
        ...(apps.length
          ? {
              effects: {
                status,
                buttons: status.apps.flatMap((s) => s.actions).slice(0, 8),
                kind: "status_shown",
              },
            }
          : {}),
      };
    });
  }

  async start_status_check(): Promise<ToolOutcome> {
    return this.run(async (tx, conv) => {
      const { ctx } = this.o;
      if (!conv.contactEmail) toolError("the visitor's email is not on file yet");
      if (await hasStatusSession(ctx, tx, conv)) return { result: { verified: true, next: "call my_status" } };
      // The per-IP budget the button route also uses.
      if (this.o.codeQuota && !this.o.codeQuota())
        return {
          result: { status: "too_many_requests" },
          final: this.t.statusCheckBusy,
          effects: { kind: "rate_limited" },
        };
      const sent = await startCode(ctx, tx, conv);
      const flow = this.setFlow(sent.flow ?? { step: "asking_status_code" });
      // Neutral on purpose (D34): the same words whether or not this email has records.
      return {
        result: { status: "code requested" },
        final: this.t.statusCodeSentChat(maskEmail(conv.contactEmail!)),
        effects: { flow, input: "code", kind: "status_code_sent" },
      };
    }, true);
  }

  // ------------------------------------------------------------ choices and hand-off

  async offer_choices(a: Parameters<AgentBackend["offer_choices"]>[0]): Promise<ToolOutcome> {
    return this.run(async (tx) => {
      const { ctx } = this.o;
      const t = this.t;
      const today = ctx.clock.today();
      const values = a.options.map((x) => x.value.trim());
      if (new Set(values).size !== values.length) toolError("options must be different from each other");
      const kinds = new Set(values.map((v) => v.split(":")[0]));
      if (kinds.size !== 1) toolError("all options must be the same kind of value");
      const items: ChoiceItem[] = [];
      const labels: string[] = [];
      const communities = await listedCommunities(tx, true);
      for (const v of values) {
        const [kind, ...rest] = v.split(":");
        const body = rest.join(":");
        if (kind === "slot") {
          const m = /^([0-9a-f-]{36})@(.+)$/.exec(body);
          const at = m ? new Date(m[2]!) : null;
          if (!m || !at || Number.isNaN(at.getTime())) return toolError(`not a slot value: ${v}`);
          const unitId = this.unitId(m[1]!);
          if (!this.issuedSlots.get(unitId)?.has(at.getTime()))
            toolError("that slot was not returned by viewing_slots in this message");
          if (items.some((i) => i.kind === "slot" && i.unitId !== unitId)) toolError("slots must be for one unit");
          items.push({ kind: "slot", unitId, slot: at.toISOString() });
          labels.push(formatSlot(at, this.lang));
        } else if (kind === "unit") {
          const unitId = this.unitId(body);
          const u = await listedUnit(tx, today, unitId, true);
          if (!u) return toolError("that unit is no longer available");
          items.push({ kind: "unit", unitId });
          labels.push(`${u.building} · ${u.bedrooms !== null ? t.bedrooms(u.bedrooms) : u.code}`);
        } else if (kind === "area") {
          const hit = communities.find((c) => c.toLowerCase() === body.trim().toLowerCase());
          if (!hit) return toolError(`unknown area; areas with homes: ${communities.join("; ")}`);
          items.push({ kind: "area", community: hit });
          labels.push(hit);
        } else if (kind === "category") {
          const c = PropertyCategory.safeParse(body);
          if (!c.success) return toolError("category must be residential, commercial or retail");
          items.push({ kind: "category", category: c.data });
          labels.push(
            { residential: t.categoryResidential, commercial: t.categoryCommercial, retail: t.categoryRetail }[c.data],
          );
        } else if (kind === "bedrooms") {
          const n = Number(body);
          if (!Number.isInteger(n) || n < 0 || n > 4) return toolError("bedrooms must be 0 to 4");
          items.push({ kind: "bedrooms", bedrooms: n });
          labels.push(t.bedrooms(n));
        } else {
          return toolError(`unknown choice value: ${v}`);
        }
      }
      const id = randomBytes(4).toString("hex");
      const slotItem = items.find((i) => i.kind === "slot");
      const flow = this.setFlow({
        ...(slotItem ? withoutApply(this.flow) : this.flow),
        choiceSet: { id, items },
        ...(slotItem?.kind === "slot" ? { step: "choosing_slot" as const, unitId: slotItem.unitId } : {}),
      });
      // Labels are written by code from the stored values, never taken from the model: no model
      // text reaches a button, so no date or amount on one can be invented.
      const choices = {
        question: a.question.trim().slice(0, 300),
        options: labels.map((label, i) => ({ label: label.slice(0, 64), data: `pick:${id}:${i}` })),
      };
      return {
        result: { shown: choices.options.length },
        final: choices.question,
        modelAuthored: true,
        effects: { choices, flow, kind: "agent_choices" },
      };
    });
  }

  async handoff(a: Parameters<AgentBackend["handoff"]>[0]): Promise<ToolOutcome> {
    // The web chat never hands to a person (D31): the fixed reply, no task, no state change.
    const t = this.t;
    return {
      result: { status: "declined" },
      final: a.reason === "existing_tenant" ? t.existingTenantWeb : t.autopilotCant,
      effects: {
        buttons: webMenuButtons(this.lang),
        kind: a.reason === "existing_tenant" ? "existing_tenant_web" : "autopilot_declined",
      },
    };
  }
}

// ---------------------------------------------------------------- a turn

const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** a***@example.com */
const maskEmails = (text: string) =>
  text.replace(EMAIL_IN_TEXT, (e) => `${e.slice(0, 1)}***${e.slice(e.indexOf("@"))}`);

/**
 * The copy of a run kept in `helper_runs` (rule 8): no typed name or company in the flow, no email
 * in the text, and no status details (a status turn keeps only that it happened).
 */
export function redacted(data: AgentData): AgentData {
  const fx = data.effects;
  const flow = fx.flow ? (({ nameEn: _n, companyName: _c, ...rest }) => rest)(fx.flow) : undefined;
  const effects = { ...fx, ...(flow ? { flow } : {}), ...(fx.status ? { status: { apps: [] } } : {}) };
  // Unverified spans are text the model wrote (a phone, an email, a link): masked like the answer.
  const unverified = data.unverified.map((u) => maskEmails(maskPiiText(u)));
  return {
    ...data,
    text: fx.status ? "(not stored: status shown)" : maskEmails(data.text),
    effects,
    unverified,
  };
}

export interface AgentTurn {
  /** The agent was at its concurrency limit: nothing ran and nothing is recorded. */
  busy?: boolean;
  run: RunRecord<AgentData>;
  helperRunId: string;
  language: EnquiryLanguage;
}

/** The recent text of this chat, oldest first, without the message being answered. */
async function history(tx: Tx, conversationId: string, exceptId: string): Promise<AgentContext["history"]> {
  const rows = await tx.db
    .select({ id: messages.id, direction: messages.direction, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.at), desc(messages.id))
    .limit(MAX_HISTORY + 6);
  return (
    rows
      // The stored stand-in for a status panel is not an answer: the model must call my_status again, never repeat it.
      .filter(
        (m) =>
          m.id !== exceptId &&
          !m.body.startsWith("[button]") &&
          m.body !== "(code entered)" &&
          !isStatusStandIn(m.body),
      )
      .slice(0, MAX_HISTORY)
      .toReversed()
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.body.slice(0, 600),
      }))
  );
}

/** Phase 2 of a free-text message on the web: context from the database, then the model loop with no locks held. */
export async function runCustomerAgent(
  ctx: EngineContext,
  conv: ConvRow,
  policy: CompanyPolicy,
  text: string,
  inboundId: string,
  codeQuota?: () => boolean,
): Promise<AgentTurn> {
  const model = ctx.customerAgent;
  if (!model) throw new Error("the customer agent is not configured");
  // A small global semaphore (in memory, per process): when full, answer at once instead of queueing for minutes.
  if (activeTurns >= (ctx.customerAgentLimits?.maxConcurrent ?? AGENT_MAX_CONCURRENT)) {
    const language = detectLanguage(text, langOf(conv));
    const run: RunRecord<AgentData> = {
      result: { status: "needs_human", reasons: ["busy"], sourceDocIds: [] },
      attempts: 0,
      latencyMs: 0,
      inputHash: "busy",
    };
    return { busy: true, run, helperRunId: newId(), language };
  }
  activeTurns++;
  try {
    return await runTurn(ctx, conv, policy, text, inboundId, model, codeQuota);
  } finally {
    activeTurns--;
  }
}

async function runTurn(
  ctx: EngineContext,
  conv: ConvRow,
  policy: CompanyPolicy,
  text: string,
  inboundId: string,
  model: AgentModel,
  codeQuota?: () => boolean,
): Promise<AgentTurn> {
  const today = ctx.clock.today();
  const language = detectLanguage(text, langOf(conv));
  const prepared = await withTx(ctx.database, async (tx) => {
    const unit = conv.flow.unitId ? await listedUnit(tx, today, conv.flow.unitId, true) : null;
    const shown: AgentContext["shown"] = [];
    for (const id of conv.flow.shown ?? []) {
      const u = await listedUnit(tx, today, id, true);
      if (u)
        shown.push({ unitId: u.id, code: u.code, building: u.building, community: u.community, bedrooms: u.bedrooms });
    }
    return {
      shown,
      communities: await listedCommunities(tx, true),
      unit: unit ? { code: unit.code, building: unit.building, community: unit.community } : null,
      history: await history(tx, conv.id, inboundId),
      statusVerified: await hasStatusSession(ctx, tx, conv),
    };
  });
  const context: AgentContext = {
    text,
    language,
    today,
    weekday: DAY_NAMES[new Date(`${today}T00:00:00Z`).getUTCDay()]!,
    history: prepared.history,
    communities: prepared.communities,
    filters: chatFilters(conv.flow) as ChatFilters,
    shown: prepared.shown,
    step: conv.flow.step,
    unit: prepared.unit,
    emailKnown: !!conv.contactEmail,
    statusVerified: prepared.statusVerified,
    applyEnabled: policy.autopilot.apply_without_viewing,
    sriEnabled: policy.autopilot.agent_sri_answers,
  };
  const backend = new WebAgentBackend({ ctx, conversationId: conv.id, flow: conv.flow, language, text, codeQuota });
  const helperRunId = newId();
  const deadlineMs = ctx.customerAgentLimits?.deadlineMs ?? AGENT_DEADLINE_MS;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      backend.cancel();
      resolve("timeout");
    }, deadlineMs);
  });
  const running = runOnly(
    ctx,
    customerAgent(model, backend, { signal: abort.signal }),
    CustomerAgentSchemas,
    { kind: "conversation", id: conv.id },
    "web_chat",
    context,
    ctx.rulesVersion,
    helperRunId,
  );
  running.catch(() => {}); // after a timeout its outcome is ignored
  const started = performance.now(); // diagnostic latency only
  const won = await Promise.race([running, timedOut]);
  clearTimeout(timer);
  if (won === "timeout") {
    // The fixed error reply is sent and the inbound message is marked answered by the caller, so a redelivery isn't run again.
    const run: RunRecord<AgentData> = {
      result: {
        status: "needs_human",
        data: { text: "", kind: "fallback", fallback: "timeout", effects: {}, tools: [], unverified: [], language },
        reasons: [`The agent did not answer within ${Math.round(deadlineMs / 1000)} s.`],
        sourceDocIds: [],
        model: { name: model.name },
      },
      attempts: 1,
      latencyMs: performance.now() - started,
      inputHash: "timeout",
      error: "turn deadline",
    };
    return { run, helperRunId, language };
  }
  return { run: won, helperRunId, language };
}

/**
 * Phase 3: the run is recorded without personal details (a status summary and the text of a status
 * turn are not kept), and the reply is built. `stale` (the customer's flow moved on while the model
 * worked) keeps the reply but drops the flow change. Fixed lines cover every failure.
 */
export async function recordAndOutcome(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  turn: AgentTurn,
  stale: boolean,
): Promise<Outcome> {
  const { run } = turn;
  if (turn.busy)
    return {
      language: turn.language,
      reply: { text: enquiryCopy[turn.language].agentBusy },
      kind: "agent_busy",
    };
  const data = run.result.data;
  const recorded: RunRecord<AgentData> = data ? { ...run, result: { ...run.result, data: redacted(data) } } : run;
  await recordRun(
    ctx,
    tx,
    "customer_agent",
    { kind: "conversation", id: conv.id },
    ctx.rulesVersion,
    recorded,
    turn.helperRunId,
  );

  const lang = turn.language;
  const t = enquiryCopy[lang];
  const base = { language: turn.language };
  if (run.result.status === "failed" || !data || data.kind === "fallback") {
    const unsure = data?.fallback === "value_check" || data?.fallback === "empty";
    return {
      ...base,
      reply: { text: unsure ? t.agentUnsure : t.agentError, buttons: webMenuButtons(lang) },
      kind: "agent_fallback",
    };
  }
  const fx = data.effects;
  const status = fx.status && fx.status.apps.length ? fx.status : undefined;
  // The tracker draws the details; its caption is one line.
  const text = status ? data.text.replace(/\s*\n+\s*/g, " ") : data.text;
  const reply: ChannelReply = {
    text,
    ...(fx.cards?.length ? { cards: fx.cards } : {}),
    ...(fx.choices ? { choices: fx.choices } : {}),
    ...(status ? { status } : {}),
    ...(fx.input ? { input: fx.input } : {}),
    ...(fx.buttons?.length ? { buttons: fx.buttons } : {}),
  };
  return {
    ...base,
    reply,
    ...(status ? { stored: { text: t.statusShownStored } } : {}),
    kind: fx.kind ?? "agent_answer",
    ...(!stale && fx.flow ? { flow: fx.flow } : {}),
  };
}
