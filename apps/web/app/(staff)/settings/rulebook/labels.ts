/** Shapes and plain-English labels for rulebook versions (engine `GET /api/rulebooks/:version`). */

export interface Band {
  gapUpTo: number;
  maxIncrease: number;
}

export interface RuleValues {
  renewalNoticeDays: number;
  renewalSendAtDays: number;
  repossessionNoticeMonths: number;
  ownUseLockYears: { residential: number; commercial: number };
  lateRentDaysAfterFormalReminder: number;
  rentCapBands: Band[];
  aboveLastBandMaxIncrease: number;
  renewalSchedule: {
    landlordIntentMonthsBefore: number;
    assessMonthsBefore: number;
    draftNoticeMonthsBefore: number;
  };
  sources: string[];
}

export interface ReferenceRule {
  id: string;
  title: string;
  text: string;
}

export interface Change {
  field: string;
  from?: unknown;
  to?: unknown;
}

export interface Loosened {
  field: string;
  base: unknown;
  value: unknown;
}

export interface RulebookSummary {
  version: string;
  status: "draft" | "published";
  basedOn: string | null;
  effectiveFrom: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  referenceRuleCount: number;
}

export interface RulebookDetail extends Omit<RulebookSummary, "referenceRuleCount"> {
  active: string | null;
  today: string;
  baseVersion: string;
  updatedAt: string;
  values: RuleValues;
  referenceRules: ReferenceRule[];
  loosened: Loosened[];
  changesVsActive: Change[];
  events: {
    id: string;
    type: string;
    actor: string;
    actorName: string | null;
    at: string;
    payload: Record<string, unknown>;
  }[];
}

/** Single number fields: path in `values`, label, help text, unit. */
export const NUMBER_FIELDS: { path: string; label: string; hint: string; unit: string }[] = [
  {
    path: "renewalNoticeDays",
    label: "Rent-increase notice",
    hint: "Legal minimum written notice before lease end for a rent change at renewal.",
    unit: "days",
  },
  {
    path: "renewalSendAtDays",
    label: "Company send day",
    hint: "When the approved notice is emailed, before lease end. At least the legal notice.",
    unit: "days",
  },
  {
    path: "repossessionNoticeMonths",
    label: "Repossession notice",
    hint: "Notice for sale, own use, major works or demolition, by notary or registered mail.",
    unit: "months",
  },
  {
    path: "ownUseLockYears.residential",
    label: "Own-use lock, residential",
    hint: "How long a unit taken back for own use can't be re-let.",
    unit: "years",
  },
  {
    path: "ownUseLockYears.commercial",
    label: "Own-use lock, commercial",
    hint: "The same lock for commercial units.",
    unit: "years",
  },
  {
    path: "lateRentDaysAfterFormalReminder",
    label: "Late rent: wait after formal reminder",
    hint: "Eviction for unpaid rent can start only this many days after a formal reminder.",
    unit: "days",
  },
  {
    path: "renewalSchedule.landlordIntentMonthsBefore",
    label: "Ask the landlord's intent",
    hint: "Sell, own use, major works or demolition? Must come before the repossession notice deadline.",
    unit: "months before end",
  },
  {
    path: "renewalSchedule.assessMonthsBefore",
    label: "Renewal assessment",
    hint: "SRI average and legal cap are worked out.",
    unit: "months before end",
  },
  {
    path: "renewalSchedule.draftNoticeMonthsBefore",
    label: "Draft the notice",
    hint: "The renewal notice is drafted and sent for approval. Must fall before the send day.",
    unit: "months before end",
  },
  {
    path: "aboveLastBandMaxIncrease",
    label: "Increase above the last band",
    hint: "Max increase when rent is further below the SRI average than the last band.",
    unit: "%",
  },
];

export function readPath(values: RuleValues, path: string): number {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], values) as number;
}

export function writePath(values: RuleValues, path: string, n: number): RuleValues {
  const [a, b] = path.split(".") as [string, string | undefined];
  const v = structuredClone(values) as unknown as Record<string, Record<string, number> | number>;
  if (b) (v[a] as Record<string, number>)[b] = n;
  else v[a] = n;
  return v as unknown as RuleValues;
}

/** "values.rentCapBands.1.gapUpTo" or "referenceRules.pets.text" → a label people understand. */
export function fieldLabel(raw: string): string {
  const path = raw.replace(/^values\./, "");
  const known = NUMBER_FIELDS.find((f) => f.path === path);
  if (known) return `${known.label} (${known.unit})`;
  let m = /^rentCapBands\.(\d+)\.(gapUpTo|maxIncrease)$/.exec(path);
  if (m) return `Band ${Number(m[1]) + 1}: ${m[2] === "gapUpTo" ? "gap below SRI up to (%)" : "max increase (%)"}`;
  if (path === "rentCapBands") return "Rent-cap bands";
  m = /^sources\.(\d+)$/.exec(path);
  if (m) return `Source ${Number(m[1]) + 1}`;
  if (path === "sources") return "Sources";
  m = /^referenceRules\.([^.]+)\.(title|text|id)$/.exec(path);
  if (m) return `Reference note “${m[1]}”: ${m[2]}`;
  if (path === "effectiveFrom") return "Effective from";
  return path;
}

export const show = (v: unknown) => (v === undefined || v === null ? "—" : String(v));

/** Labels for the rent-cap bands as staff read them (same comparison as the rulebook). */
export function bandRows(values: RuleValues): { gap: string; max: number }[] {
  const rows = values.rentCapBands.map((b, i) => ({
    gap: i === 0 ? `Up to ${b.gapUpTo}%` : `Over ${values.rentCapBands[i - 1]!.gapUpTo}% up to ${b.gapUpTo}%`,
    max: b.maxIncrease,
  }));
  const last = values.rentCapBands.at(-1);
  rows.push({ gap: `Over ${last?.gapUpTo ?? 0}%`, max: values.aboveLastBandMaxIncrease });
  return rows;
}
