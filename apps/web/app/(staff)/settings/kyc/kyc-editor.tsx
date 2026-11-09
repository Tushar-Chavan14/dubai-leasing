"use client";

import { type ReactNode, useState, useTransition } from "react";
import {
  checksFor,
  type CustomCategory,
  defaultDocRules,
  expiryFor,
  issueFor,
  LOCKED_SEVERITY,
  type ReadDocKind,
} from "@leasing/core";
import { AskAiMenu } from "../../../../components/ask-ai";
import { PlusIcon as IconPlus, TrashIcon as IconTrash, WarningIcon as IconWarning } from "@phosphor-icons/react";
import type { RuleResult } from "../../../../lib/portfolio";
import { discardKycDraft, publishKycDraft, saveKycDraft } from "./actions";
import { FIELD, HINT, LABEL } from "../../../../components/ui/form";
import { Button } from "../../../../components/ui/button";
import {
  ALERT,
  BTN,
  FormGrid,
  SaveBar,
  Preview,
  CHECK_ROW,
  GRID6,
  SPAN,
  SET_INPUT,
  SET_SELECT,
  SET_TEXTAREA,
} from "../../../../components/ui/settings";

type FieldType = "text" | "email" | "phone" | "date" | "number" | "select" | "document";
type DocKind = "emirates_id_front" | "emirates_id_back" | "passport" | "visa" | "trade_licence" | "custom" | "other";
type AppliesTo = "individual" | "company" | "both";
interface DocRules {
  validityDays?: number | undefined;
  issuedWithinDays?: number | undefined;
  minConfidence: number;
  checks: Record<string, Setting>;
}
interface Field {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  type: FieldType;
  required: boolean;
  appliesTo: AppliesTo;
  options: string[];
  documentKind?: DocKind;
  nameAsPerDocuments: boolean;
  /** A read document field's own checks (D49). */
  rules?: DocRules;
  /** A custom document's name and description (D50). */
  customCategory?: CustomCategory;
}
type Severity = "off" | "warning" | "blocker";
interface Setting {
  severity: Severity;
  emailApplicant: boolean;
}
interface Checks {
  cross: Record<string, Setting>;
  applicantNameMode: "lenient" | "exact";
}
interface Base {
  checks: Checks;
  validityDays: number;
  minConfidence: number;
  requiredDocuments: boolean;
  emiratesIdFormat: boolean;
  passportMrz: boolean;
  visaFormat: boolean;
  namesConsistent: boolean;
  applicantName: "off" | "lenient" | "exact";
  idNumbersConsistent: boolean;
}
type Rule = Setting & { id: string; label: string } & (
    | { type: "answer_matches_document"; fieldKey: string; identityField: string }
    | { type: "answer_required"; fieldKey: string; appliesTo: AppliesTo; allowed: string[] }
    | { type: "document_required"; documentKind: DocKind; appliesTo: AppliesTo }
    | { type: "min_age"; years: number }
    | { type: "document_value_pattern"; identityField: string; pattern: string; describe: string }
    | { type: "ai_check"; instruction: string }
  );
export interface KycConfigView {
  version: number;
  form: Field[];
  rules: { base: Base; company: Rule[] };
}

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  email: "Email",
  phone: "Phone",
  date: "Date",
  number: "Number",
  select: "Choice list",
  document: "Document photo",
};
const DOC_LABEL: Record<DocKind, string> = {
  emirates_id_front: "Emirates ID, front",
  emirates_id_back: "Emirates ID, back",
  passport: "Passport data page",
  visa: "Residence visa",
  trade_licence: "Trade licence",
  custom: "Custom document (AI reads it)",
  other: "Other (kept for staff, not read)",
};
const APPLIES: Record<AppliesTo, string> = { both: "Everyone", individual: "Individuals", company: "Companies" };
/** Each check's question and what it looks at; `{days}`, `{pct}` and `{doc}` are filled in from the settings. */
const CHECK_TEXT: Record<string, { q: string; what: string }> = {
  issued_recently: {
    q: "Issued recently?",
    what: "Issued within the last {issued} days (the issue date must be readable).",
  },
  name_matches: { q: "Holder is the applicant?", what: "The name on it is the applicant's (or the company's)." },
  expired: {
    q: "Has it expired?",
    what: "Expired, or expiring before the lease starts. Never passes, not even by approval.",
  },
  valid_long_enough: { q: "Valid long enough?", what: "Must stay valid at least {days} days after the lease starts." },
  readable: { q: "Read clearly?", what: "Every needed field read with at least {pct}% confidence." },
  right_document: { q: "Right document?", what: "The upload really is this document, not another one." },
  id_number: { q: "ID number valid?", what: "The number has the 784 format and a correct check digit." },
  birth_year: { q: "Birth year matches?", what: "The birth year inside the ID number matches the date of birth." },
  mrz: { q: "Bottom two lines valid?", what: "The machine-readable lines pass their check digits." },
  mrz_matches_page: {
    q: "Bottom lines match the page?",
    what: "Number, name and expiry printed on the page match the machine-readable lines.",
  },
  visa_number: { q: "Visa file number valid?", what: "The file number has the 000/0000/0000000 form." },
  passport_matches: { q: "Same passport?", what: "The passport number on the visa matches the uploaded passport." },
  required_documents: { q: "Everything uploaded?", what: "Every document the form marks required for this applicant." },
  names_consistent: { q: "Same name everywhere?", what: "The name is the same on every document." },
  applicant_name: {
    q: "Applicant's name matches?",
    what: "The name as per documents on the form matches the documents.",
  },
};
const CROSS_CHECKS = ["required_documents", "names_consistent", "applicant_name"];
const SEVERITY_LABEL: Record<Severity, string> = { off: "Off", warning: "Warning", blocker: "Blocker" };

/** What happens when the check fails, in plain words. */
function outcome(s: Setting): string {
  if (s.severity === "off") return "Not checked.";
  if (s.severity === "warning") return "If it fails: a person reviews it and can approve.";
  return s.emailApplicant
    ? "If it fails: it can't be approved, and the applicant is emailed a new upload link with the reason."
    : "If it fails: it can't be approved; staff ask the applicant for a new document.";
}
const RULE_LABEL: Record<Rule["type"], string> = {
  answer_matches_document: "Answer matches a document",
  answer_required: "Answer required",
  document_required: "Document required",
  min_age: "Minimum age",
  document_value_pattern: "Document value matches a pattern",
  ai_check: "Custom check (AI, warning only)",
};
const PATTERN_FIELD: Record<string, string> = {
  emiratesIdNo: "Emirates ID number",
  passportNo: "Passport number",
  visaNo: "Visa number",
  tradeLicenceNo: "Trade licence number",
  companyName: "Company name (trade licence)",
};
const IDENTITY: Record<string, string> = {
  fullNameEn: "Full name",
  birthDate: "Date of birth",
  emiratesIdNo: "Emirates ID number",
  passportNo: "Passport number",
  visaNo: "Visa number",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40) || "field";
const ruleId = () => `r${Math.random().toString(36).slice(2, 10)}`;

function newRule(type: Rule["type"], answerKeys: string[]): Rule {
  const c = { id: ruleId(), severity: "warning" as const, emailApplicant: false };
  switch (type) {
    case "answer_matches_document":
      return {
        ...c,
        type,
        label: "Answer matches document",
        fieldKey: answerKeys[0] ?? "",
        identityField: "birthDate",
      };
    case "answer_required":
      return { ...c, type, label: "Answer required", fieldKey: answerKeys[0] ?? "", appliesTo: "both", allowed: [] };
    case "document_required":
      return { ...c, type, label: "Document required", documentKind: "passport", appliesTo: "both" };
    case "min_age":
      return { ...c, type, label: "Minimum age", years: 21 };
    case "document_value_pattern":
      return {
        ...c,
        type,
        label: "Licence number format",
        identityField: "tradeLicenceNo",
        pattern: "^\\d{6,7}$",
        describe: "6 or 7 digits",
      };
    case "ai_check":
      return { ...c, type, label: "Custom check", instruction: "" };
  }
}

/** Off / Warning / Blocker, plus "email the applicant" on a blocker, and the plain-words outcome. */
function SeverityControl({
  value,
  onChange,
  locked = [],
  disabled,
}: {
  value: Setting;
  onChange: (s: Setting) => void;
  locked?: Severity[];
  disabled: boolean;
}) {
  return (
    <div className="grid justify-items-start gap-1.5 @[560px]:justify-items-end">
      <select
        className={SET_SELECT}
        aria-label="If it fails"
        value={value.severity}
        disabled={disabled}
        onChange={(e) => {
          const severity = e.target.value as Severity;
          onChange({ severity, emailApplicant: severity === "blocker" && value.emailApplicant });
        }}
      >
        {(Object.keys(SEVERITY_LABEL) as Severity[])
          .filter((v) => !locked.includes(v) || v === value.severity)
          .map((v) => (
            <option key={v} value={v}>
              {SEVERITY_LABEL[v]}
            </option>
          ))}
      </select>
      {value.severity === "blocker" && (
        <label className={CHECK_ROW}>
          <input
            type="checkbox"
            checked={value.emailApplicant}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, emailApplicant: e.target.checked })}
          />
          Email applicant to re-upload
        </label>
      )}
    </div>
  );
}

/** One check: its question, what it looks at (with the current numbers), and what happens when it fails. */
function CheckRow({
  check,
  fill,
  value,
  onChange,
  disabled,
  children,
}: {
  check: string;
  fill: Record<string, string>;
  value: Setting;
  onChange: (s: Setting) => void;
  disabled: boolean;
  children?: ReactNode;
}) {
  const t = CHECK_TEXT[check]!;
  const what = t.what.replace(/\{(\w+)\}/g, (_, k: string) => fill[k] ?? "");
  return (
    <li
      className="grid items-start gap-x-4 gap-y-2 border-t border-dashed border-line py-2.5 first:border-t-0 @[560px]:grid-cols-[1fr_auto] data-[severity=off]:[&_strong]:text-muted"
      data-severity={value.severity}
    >
      <div>
        <strong>{t.q}</strong>
        <p className="m-0 mt-0.5 text-[13px] text-muted">
          {what} {outcome(value)}
        </p>
        {children}
      </div>
      <SeverityControl
        value={value}
        onChange={onChange}
        locked={LOCKED_SEVERITY[check as keyof typeof LOCKED_SEVERITY] ?? []}
        disabled={disabled}
      />
    </li>
  );
}

/** A document field's own checks: its numbers, then each check with its severity. */
function DocChecks({
  kind,
  custom,
  rules,
  onChange,
  disabled,
}: {
  kind: ReadDocKind | "custom";
  custom?: CustomCategory | undefined;
  rules: DocRules;
  onChange: (patch: Partial<DocRules>) => void;
  disabled: boolean;
}) {
  const pct = Math.round(rules.minConfidence * 100);
  const fill = { days: String(rules.validityDays ?? 0), pct: String(pct), issued: String(rules.issuedWithinDays ?? 0) };
  const expiry = expiryFor(kind, custom);
  const count = (sev: Severity) => Object.values(rules.checks).filter((c) => c.severity === sev).length;
  return (
    <details className="rounded-xl border border-line px-3.5 [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:flex-wrap [&>summary]:items-baseline [&>summary]:gap-x-3 [&>summary]:gap-y-1 [&>summary]:py-3 [&[open]>summary]:mb-3 [&[open]>summary]:border-b [&[open]>summary]:border-line">
      <summary>
        <strong>Checks for this document</strong>
        <span className="text-muted">
          {expiry ? `valid ${rules.validityDays}+ days · ` : ""}read {pct}%+ · {count("blocker")} blocker
          {count("blocker") === 1 ? "" : "s"}, {count("warning")} warning{count("warning") === 1 ? "" : "s"}
        </span>
      </summary>
      <div className={GRID6}>
        {expiry && (
          <label className={`${FIELD} ${SPAN[3]}`}>
            <span className={LABEL}>Valid at least this many days after the lease starts</span>
            <input
              className={SET_INPUT}
              type="number"
              min={0}
              max={3650}
              value={rules.validityDays ?? 0}
              disabled={disabled}
              onChange={(e) => onChange({ validityDays: Number(e.target.value) })}
            />
          </label>
        )}
        <label className={`${FIELD} ${SPAN[3]}`}>
          <span className={LABEL}>Minimum read confidence (%)</span>
          <input
            className={SET_INPUT}
            type="number"
            min={50}
            max={100}
            step={5}
            value={pct}
            disabled={disabled}
            onChange={(e) => onChange({ minConfidence: Number(e.target.value) / 100 })}
          />
        </label>
        {issueFor(kind) && (
          <label className={`${FIELD} ${SPAN[3]}`}>
            <span className={LABEL}>Issued within this many days (for &quot;Issued recently?&quot;)</span>
            <input
              className={SET_INPUT}
              type="number"
              min={1}
              max={3650}
              value={rules.issuedWithinDays ?? 90}
              disabled={disabled}
              onChange={(e) => onChange({ issuedWithinDays: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
      <ul className="mx-0 my-2 grid list-none gap-0 p-0">
        {checksFor(kind, custom).map((k) => (
          <CheckRow
            key={k}
            check={k}
            fill={fill}
            value={rules.checks[k] ?? { severity: "off", emailApplicant: false }}
            disabled={disabled}
            onChange={(v) => onChange({ checks: { ...rules.checks, [k]: v } })}
          />
        ))}
      </ul>
    </details>
  );
}

export function KycEditor({
  companyId,
  initial,
  canEdit,
  hasDraft,
  companyName,
}: {
  companyId: string;
  initial: KycConfigView;
  canEdit: boolean;
  hasDraft: boolean;
  companyName: string;
}) {
  const [fields, setFields] = useState<Field[]>(initial.form);
  const [base] = useState<Base>(initial.rules.base);
  const [checks, setChecks] = useState<Checks>(initial.rules.base.checks);
  const setDocRules = (i: number, patch: Partial<DocRules>) =>
    setFields((fs) => fs.map((f, j) => (j === i && f.rules ? { ...f, rules: { ...f.rules, ...patch } } : f)));
  const [rules, setRules] = useState<Rule[]>(initial.rules.company);
  const [result, setResult] = useState<RuleResult>({});
  const [saving, start] = useTransition();
  const answerKeys = fields.filter((f) => f.type !== "document").map((f) => f.key);
  const ro = !canEdit;

  const setField = (i: number, patch: Partial<Field>) =>
    setFields((fs) =>
      fs.map((f, j) => {
        if (patch.nameAsPerDocuments && j !== i) return { ...f, nameAsPerDocuments: false };
        if (j !== i) return f;
        const next = { ...f, ...patch };
        if (patch.type && patch.type !== f.type) {
          // Keep the field valid for its new type.
          if (patch.type === "document") next.documentKind = f.documentKind ?? "other";
          else delete next.documentKind;
          delete next.rules;
          if (patch.type !== "text") next.nameAsPerDocuments = false;
          if (patch.type !== "select") next.options = [];
        }
        // A read category starts from its default checks; changing category starts again.
        if (next.type === "document" && next.documentKind && next.documentKind !== "other") {
          if (next.documentKind === "custom")
            next.customCategory ??= { name: next.label, description: "", hasExpiry: true };
          else delete next.customCategory;
          const restart =
            !next.rules ||
            (patch.documentKind && patch.documentKind !== f.documentKind) ||
            (patch.customCategory && patch.customCategory.hasExpiry !== f.customCategory?.hasExpiry);
          if (restart) next.rules = defaultDocRules(next.documentKind, undefined, next.customCategory);
        } else {
          delete next.rules;
          delete next.customCategory;
        }
        return next;
      }),
    );
  /** A key made once from the label when it is first edited, unique on the form. */
  const uniqueKey = (label: string, i: number) => {
    const base = slug(label).length >= 2 ? slug(label) : "field";
    const taken = new Set(fields.filter((_, j) => j !== i).map((f) => f.key));
    let k = base;
    for (let n = 2; taken.has(k); n++) k = `${base.slice(0, 36)}_${n}`;
    return k;
  };
  const usedBy = (key: string) =>
    rules.filter((r) => (r.type === "answer_matches_document" || r.type === "answer_required") && r.fieldKey === key);
  const move = (i: number, by: number) =>
    setFields((fs) => {
      const j = i + by;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const addField = () =>
    setFields((fs) => [
      ...fs,
      {
        key: `new_${Math.random().toString(36).slice(2, 8)}`,
        label: "New field",
        placeholder: "",
        help: "",
        type: "text",
        required: false,
        appliesTo: "both",
        options: [],
        nameAsPerDocuments: false,
      },
    ]);
  const setRule = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, j) => (j === i ? ({ ...r, ...patch } as Rule) : r)));

  const [done, setDone] = useState<string | null>(null);
  const payload = () => ({ base: { ...base, checks }, company: rules });
  const save = (publish: boolean) =>
    start(async () => {
      setDone(null);
      const r = await saveKycDraft(companyId, fields, payload());
      if (!r.ok || !publish) {
        setResult(r);
        if (r.ok) setDone("Draft saved. Applicants still get the live version until you publish.");
        return;
      }
      const p = await publishKycDraft(companyId);
      setResult(p);
      if (p.ok)
        setDone("Published. New uploads use it; earlier applications keep the version they were checked against.");
    });
  const discard = () =>
    start(async () => {
      if (!window.confirm("Throw the draft away? The live version stays as it is.")) return;
      setDone(null);
      setResult(await discardKycDraft(companyId));
    });

  return (
    <FormGrid preview={<FormPreview fields={fields} />}>
      <div className="grid gap-4">
        <section className="grid gap-3.5 rounded-card border border-line bg-page p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">Document form</h3>
            {canEdit && (
              <button type="button" className={BTN.ghost} onClick={addField}>
                <IconPlus size={14} /> Add field
              </button>
            )}
          </div>
          <p className="m-0 text-muted">Exactly what the applicant&apos;s upload link shows, in this order.</p>
          <ol className="m-0 grid list-none gap-2.5 p-0">
            {fields.map((f, i) => (
              <li key={i} className="grid gap-2.5 rounded-xl border border-line p-3.5">
                <div className={GRID6}>
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Label</span>
                    <input
                      className={SET_INPUT}
                      value={f.label}
                      disabled={ro}
                      onChange={(e) => setField(i, { label: e.target.value })}
                      onBlur={(e) => {
                        if (f.key.startsWith("new_")) setField(i, { key: uniqueKey(e.target.value, i) });
                      }}
                    />
                  </label>
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Type</span>
                    <select
                      className={SET_SELECT}
                      value={f.type}
                      disabled={ro}
                      onChange={(e) => setField(i, { type: e.target.value as FieldType })}
                    >
                      {Object.entries(TYPE_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Shown to</span>
                    <select
                      className={SET_SELECT}
                      value={f.appliesTo}
                      disabled={ro}
                      onChange={(e) => setField(i, { appliesTo: e.target.value as AppliesTo })}
                    >
                      {Object.entries(APPLIES).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  {f.type === "document" ? (
                    <label className={`${FIELD} ${SPAN[3]}`}>
                      <span className={LABEL}>Document</span>
                      <select
                        className={SET_SELECT}
                        value={f.documentKind ?? "other"}
                        disabled={ro}
                        onChange={(e) => setField(i, { documentKind: e.target.value as DocKind })}
                      >
                        {Object.entries(DOC_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className={`${FIELD} ${SPAN[3]}`}>
                      <span className={LABEL}>Placeholder</span>
                      <input
                        className={SET_INPUT}
                        value={f.placeholder}
                        disabled={ro}
                        onChange={(e) => setField(i, { placeholder: e.target.value })}
                      />
                    </label>
                  )}
                  <label className={`${FIELD} ${SPAN[3]}`}>
                    <span className={LABEL}>Help text</span>
                    <input
                      className={SET_INPUT}
                      value={f.help}
                      disabled={ro}
                      onChange={(e) => setField(i, { help: e.target.value })}
                    />
                  </label>
                  {f.type === "select" && (
                    <label className={`${FIELD} ${SPAN[6]}`}>
                      <span className={LABEL}>Choices, one per line</span>
                      <textarea
                        className={SET_TEXTAREA}
                        rows={3}
                        value={f.options.join("\n")}
                        disabled={ro}
                        onChange={(e) => setField(i, { options: e.target.value.split("\n").filter((o) => o.trim()) })}
                      />
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className={CHECK_ROW}>
                    <input
                      type="checkbox"
                      checked={f.required}
                      disabled={ro}
                      onChange={(e) => setField(i, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  {f.type === "text" && (
                    <label className={CHECK_ROW}>
                      <input
                        type="radio"
                        name="nameAsPerDocuments"
                        checked={f.nameAsPerDocuments}
                        disabled={ro}
                        onChange={() => setField(i, { nameAsPerDocuments: true })}
                      />
                      Name as per documents (used for the name check)
                    </label>
                  )}
                  <span className="text-xs text-muted">key: {f.key}</span>
                  {canEdit && (
                    <>
                      <button type="button" className={BTN.ghost} onClick={() => move(i, -1)} disabled={i === 0}>
                        Up
                      </button>
                      <button
                        type="button"
                        className={BTN.ghost}
                        onClick={() => move(i, 1)}
                        disabled={i === fields.length - 1}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className={BTN.ghost}
                        onClick={() => {
                          const users = usedBy(f.key);
                          if (
                            users.length &&
                            !window.confirm(
                              `Rules use this field (${users.map((r) => r.label).join(", ")}). Remove those rules too?`,
                            )
                          )
                            return;
                          setRules((rs) => rs.filter((r) => !users.includes(r)));
                          setFields((fs) => fs.filter((_, j) => j !== i));
                        }}
                      >
                        <IconTrash size={14} /> Remove
                      </button>
                    </>
                  )}
                </div>
                {f.type === "document" && f.documentKind === "other" && (
                  <p className="m-0 mt-0.5 text-[13px] text-muted">
                    Kept for staff; not read, so no document checks run on it.
                  </p>
                )}
                {f.documentKind === "custom" && f.customCategory && (
                  <div className={GRID6}>
                    <label className={`${FIELD} ${SPAN[2]}`}>
                      <span className={LABEL}>Document name</span>
                      <input
                        className={SET_INPUT}
                        value={f.customCategory.name}
                        disabled={ro}
                        placeholder="For example: Salary certificate"
                        onChange={(e) =>
                          setField(i, { customCategory: { ...f.customCategory!, name: e.target.value } })
                        }
                      />
                    </label>
                    <label className={`${FIELD} ${SPAN[3]}`}>
                      <span className={LABEL}>What it looks like (helps the AI recognise it)</span>
                      <input
                        className={SET_INPUT}
                        value={f.customCategory.description}
                        disabled={ro}
                        placeholder="For example: a letter from the employer stating the monthly salary"
                        onChange={(e) =>
                          setField(i, { customCategory: { ...f.customCategory!, description: e.target.value } })
                        }
                      />
                    </label>
                    <label className={`${CHECK_ROW} ${SPAN[6]}`}>
                      <input
                        type="checkbox"
                        checked={f.customCategory.hasExpiry}
                        disabled={ro}
                        onChange={(e) =>
                          setField(i, { customCategory: { ...f.customCategory!, hasExpiry: e.target.checked } })
                        }
                      />
                      Has an expiry date
                    </label>
                  </div>
                )}
                {canEdit && f.rules && f.documentKind && f.documentKind !== "other" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <AskAiMenu
                      label="Ask AI about this document"
                      prompts={[
                        {
                          label: "How long it must be valid",
                          prompt: `For ${companyName}: the "${f.label}" must be valid this many days after the lease starts: `,
                        },
                        {
                          label: "Make a check a blocker",
                          prompt: `For ${companyName}: make the "${f.label}" "Read clearly?" check a blocker and email the applicant`,
                        },
                        {
                          label: "Issued within N days",
                          prompt: `For ${companyName}: the "${f.label}" as a warning, it must have been issued within this many days: `,
                        },
                        {
                          label: "Read confidence",
                          prompt: `For ${companyName}: read the "${f.label}" with at least this % confidence: `,
                        },
                        { label: "Explain its checks", prompt: `What checks run on ${companyName}'s "${f.label}"?` },
                      ]}
                    />
                  </div>
                )}
                {f.rules && f.documentKind && f.documentKind !== "other" && (
                  <DocChecks
                    kind={f.documentKind}
                    custom={f.customCategory}
                    rules={f.rules}
                    disabled={ro}
                    onChange={(patch) => setDocRules(i, patch)}
                  />
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-3.5 rounded-card border border-line bg-page p-5">
          <h3 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">Checks across documents</h3>
          <p className="m-0 text-muted">
            Each document&apos;s own checks are on its field in the form above. Warning: a person reviews and can
            approve. Blocker: it can&apos;t be approved, and you can have the applicant emailed a new upload link (at
            most twice per application, then a person takes over).
          </p>
          <ul className="mx-0 my-2 grid list-none gap-0 p-0">
            {CROSS_CHECKS.map((k) => (
              <CheckRow
                key={k}
                check={k}
                fill={{}}
                value={checks.cross[k]!}
                disabled={ro}
                onChange={(v) => setChecks({ ...checks, cross: { ...checks.cross, [k]: v } })}
              >
                {k === "applicant_name" && checks.cross[k]!.severity !== "off" && (
                  <select
                    className={SET_SELECT}
                    aria-label="How close"
                    value={checks.applicantNameMode}
                    disabled={ro}
                    onChange={(e) =>
                      setChecks({ ...checks, applicantNameMode: e.target.value as Checks["applicantNameMode"] })
                    }
                  >
                    <option value="lenient">Allow middle names and order</option>
                    <option value="exact">Exact</option>
                  </select>
                )}
              </CheckRow>
            ))}
          </ul>
        </section>

        <section className="grid gap-3.5 rounded-card border border-line bg-page p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">Custom checks</h3>
            {canEdit && (
              <select
                className={BTN.ghost}
                value=""
                onChange={(e) => {
                  if (e.target.value) setRules((rs) => [...rs, newRule(e.target.value as Rule["type"], answerKeys)]);
                }}
              >
                <option value="">Add custom check…</option>
                {Object.entries(RULE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </div>
          {rules.length === 0 && <p className="m-0 text-muted">No custom checks. Only the document checks apply.</p>}
          {rules.map((r, i) => (
            <div key={r.id} className="grid gap-2.5 rounded-xl border border-line p-3.5">
              <div className={GRID6}>
                <label className={`${FIELD} ${SPAN[2]}`}>
                  <span className={LABEL}>{RULE_LABEL[r.type]}</span>
                  <input
                    className={SET_INPUT}
                    value={r.label}
                    disabled={ro}
                    onChange={(e) => setRule(i, { label: e.target.value })}
                  />
                </label>
                {(r.type === "answer_matches_document" || r.type === "answer_required") && (
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Form answer</span>
                    <select
                      className={SET_SELECT}
                      value={r.fieldKey}
                      disabled={ro}
                      aria-invalid={!answerKeys.includes(r.fieldKey) || undefined}
                      onChange={(e) => setRule(i, { fieldKey: e.target.value })}
                    >
                      {!answerKeys.includes(r.fieldKey) && <option value={r.fieldKey}>Choose a field…</option>}
                      {answerKeys.map((k) => (
                        <option key={k} value={k}>
                          {fields.find((f) => f.key === k)?.label ?? k}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {r.type === "answer_matches_document" && (
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Must match</span>
                    <select
                      className={SET_SELECT}
                      value={r.identityField}
                      disabled={ro}
                      onChange={(e) => setRule(i, { identityField: e.target.value })}
                    >
                      {Object.entries(IDENTITY).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {r.type === "answer_required" && (
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Accepted answers (optional, comma separated)</span>
                    <input
                      className={SET_INPUT}
                      value={r.allowed.join(", ")}
                      disabled={ro}
                      onChange={(e) =>
                        setRule(i, {
                          allowed: e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                )}
                {r.type === "document_required" && (
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Document</span>
                    <select
                      className={SET_SELECT}
                      value={r.documentKind}
                      disabled={ro}
                      onChange={(e) => setRule(i, { documentKind: e.target.value as DocKind })}
                    >
                      {Object.entries(DOC_LABEL)
                        .filter(([v]) => v !== "other")
                        .map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {(r.type === "answer_required" || r.type === "document_required") && (
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>For</span>
                    <select
                      className={SET_SELECT}
                      value={r.appliesTo}
                      disabled={ro}
                      onChange={(e) => setRule(i, { appliesTo: e.target.value as AppliesTo })}
                    >
                      {Object.entries(APPLIES).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {r.type === "min_age" && (
                  <label className={`${FIELD} ${SPAN[2]}`}>
                    <span className={LABEL}>Years</span>
                    <input
                      className={SET_INPUT}
                      type="number"
                      min={18}
                      max={100}
                      value={r.years}
                      disabled={ro}
                      onChange={(e) => setRule(i, { years: Number(e.target.value) })}
                    />
                  </label>
                )}
                {r.type === "document_value_pattern" && (
                  <>
                    <label className={`${FIELD} ${SPAN[2]}`}>
                      <span className={LABEL}>Document value</span>
                      <select
                        className={SET_SELECT}
                        value={r.identityField}
                        disabled={ro}
                        onChange={(e) => setRule(i, { identityField: e.target.value })}
                      >
                        {Object.entries(PATTERN_FIELD).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`${FIELD} ${SPAN[2]}`}>
                      <span className={LABEL}>Pattern (regular expression)</span>
                      <input
                        className={SET_INPUT}
                        value={r.pattern}
                        disabled={ro}
                        spellCheck={false}
                        onChange={(e) => setRule(i, { pattern: e.target.value })}
                      />
                    </label>
                    <label className={`${FIELD} ${SPAN[2]}`}>
                      <span className={LABEL}>In plain words</span>
                      <input
                        className={SET_INPUT}
                        value={r.describe}
                        disabled={ro}
                        placeholder="For example: 6 or 7 digits"
                        onChange={(e) => setRule(i, { describe: e.target.value })}
                      />
                    </label>
                  </>
                )}
                {r.type === "ai_check" && (
                  <label className={`${FIELD} ${SPAN[6]}`}>
                    <span className={LABEL}>Instruction</span>
                    <textarea
                      className={SET_TEXTAREA}
                      rows={2}
                      value={r.instruction}
                      disabled={ro}
                      placeholder="For example: the Emirates ID back should show an employer."
                      onChange={(e) => setRule(i, { instruction: e.target.value })}
                    />
                    <span className={HINT}>
                      The local AI can only send the application to a person; it never approves, rejects or emails.
                    </span>
                  </label>
                )}
              </div>
              <div
                className="grid items-start gap-x-4 gap-y-2 border-t border-dashed border-line py-2.5 first:border-t-0 @[560px]:grid-cols-[1fr_auto] data-[severity=off]:[&_strong]:text-muted"
                data-severity={r.severity}
              >
                <p className="m-0 mt-0.5 text-[13px] text-muted">{outcome(r)}</p>
                <SeverityControl
                  value={r}
                  locked={r.type === "ai_check" ? ["blocker"] : []}
                  disabled={ro}
                  onChange={(v) => setRule(i, v as Partial<Rule>)}
                />
              </div>
              {canEdit && (
                <button
                  type="button"
                  className={BTN.ghost}
                  onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                >
                  <IconTrash size={14} /> Remove rule
                </button>
              )}
            </div>
          ))}
        </section>

        {result.error && (
          <div className={ALERT.bad} role="alert">
            <IconWarning size={16} />
            <div>
              <strong>{result.error}</strong>
              {(result.reasons?.length || Object.keys(result.fieldErrors ?? {}).length) && (
                <ul>
                  {[
                    ...(result.reasons ?? []),
                    ...Object.entries(result.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v}`),
                  ].map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {result.ok && done && <p className="m-0 rounded-xl bg-accent px-3.5 py-2.5 text-sm text-on-accent">{done}</p>}
        {canEdit && (
          <SaveBar
            note={
              hasDraft
                ? "Editing a draft. Applicants still get the live version until you publish."
                : "Save draft keeps your changes private. Publish makes them live for new uploads."
            }
          >
            {hasDraft && (
              <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
                Discard draft
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => save(false)} disabled={saving}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
            <Button variant="primary" size="sm" onClick={() => save(true)} disabled={saving}>
              Publish
            </Button>
          </SaveBar>
        )}
      </div>
    </FormGrid>
  );
}

const PREVIEW_TYPE: Record<FieldType, string> = {
  text: "Short answer",
  email: "Email address",
  phone: "Phone number",
  date: "Date",
  number: "Number",
  select: "Choose one",
  document: "Photo upload",
};

/** What the applicant sees on the document link: each field in order, as it is in the editor now. */
function FormPreview({ fields }: { fields: Field[] }) {
  return (
    <Preview
      title="What the applicant sees"
      lede="The upload link shows these fields in this order. It updates as you edit."
    >
      <ol className="m-0 grid list-none gap-1.5 p-0" aria-label="Applicant form preview">
        {fields.length === 0 && <li className="text-[13px] text-muted">No fields yet.</li>}
        {fields.map((f, i) => (
          <li key={`${f.key}-${i}`} className="grid gap-0.5 rounded-xl border border-line bg-page px-3 py-2">
            <span className="text-sm font-semibold">
              {f.label || "Untitled"}
              {f.required && <span className="text-danger"> *</span>}
            </span>
            <span className="text-xs text-muted">
              {f.type === "document" && f.documentKind ? DOC_LABEL[f.documentKind] : PREVIEW_TYPE[f.type]}
              {f.appliesTo === "individual" ? " · people only" : f.appliesTo === "company" ? " · companies only" : ""}
            </span>
            {f.help && <span className="text-xs text-muted">{f.help}</span>}
          </li>
        ))}
      </ol>
    </Preview>
  );
}
