"use client";

import { useState, useTransition } from "react";
import { IconPlus, IconTrash, IconWarning } from "../../../../lib/icons";
import type { RuleResult } from "../../../../lib/portfolio";
import { saveKycConfig } from "./actions";

type FieldType = "text" | "email" | "phone" | "date" | "number" | "select" | "document";
type DocKind = "emirates_id_front" | "emirates_id_back" | "passport" | "visa" | "trade_licence" | "other";
type AppliesTo = "individual" | "company" | "both";
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
}
interface Base {
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
type Rule =
  | { id: string; type: "answer_matches_document"; label: string; fieldKey: string; identityField: string }
  | { id: string; type: "answer_required"; label: string; fieldKey: string; appliesTo: AppliesTo; allowed: string[] }
  | { id: string; type: "document_required"; label: string; documentKind: DocKind; appliesTo: AppliesTo }
  | { id: string; type: "min_age"; label: string; years: number }
  | { id: string; type: "ai_check"; label: string; instruction: string };
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
  other: "Other (kept for staff, not read)",
};
const APPLIES: Record<AppliesTo, string> = { both: "Everyone", individual: "Individuals", company: "Companies" };
const BASE_SWITCHES: { key: keyof Base; label: string }[] = [
  { key: "requiredDocuments", label: "Required documents uploaded" },
  { key: "emiratesIdFormat", label: "Emirates ID number valid" },
  { key: "passportMrz", label: "Passport machine-readable zone matches the page" },
  { key: "visaFormat", label: "Visa file number format" },
  { key: "namesConsistent", label: "Same name on every document" },
  { key: "idNumbersConsistent", label: "Passport number matches between passport and visa" },
];
const RULE_LABEL: Record<Rule["type"], string> = {
  answer_matches_document: "Answer matches a document",
  answer_required: "Answer required",
  document_required: "Document required",
  min_age: "Minimum age",
  ai_check: "Custom check (AI, review only)",
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
  const id = ruleId();
  switch (type) {
    case "answer_matches_document":
      return { id, type, label: "Answer matches document", fieldKey: answerKeys[0] ?? "", identityField: "birthDate" };
    case "answer_required":
      return { id, type, label: "Answer required", fieldKey: answerKeys[0] ?? "", appliesTo: "both", allowed: [] };
    case "document_required":
      return { id, type, label: "Document required", documentKind: "passport", appliesTo: "both" };
    case "min_age":
      return { id, type, label: "Minimum age", years: 21 };
    case "ai_check":
      return { id, type, label: "Custom check", instruction: "" };
  }
}

export function KycEditor({
  companyId,
  initial,
  canEdit,
}: {
  companyId: string;
  initial: KycConfigView;
  canEdit: boolean;
}) {
  const [fields, setFields] = useState<Field[]>(initial.form);
  const [base, setBase] = useState<Base>(initial.rules.base);
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
          if (patch.type !== "text") next.nameAsPerDocuments = false;
          if (patch.type !== "select") next.options = [];
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

  const save = () =>
    start(async () => {
      setResult(await saveKycConfig(companyId, fields, { base, company: rules }));
    });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="panel panel-pad stack">
        <div className="co-body-head">
          <h3 className="section-title">Document form</h3>
          {canEdit && (
            <button type="button" className="btn small" onClick={addField}>
              <IconPlus size={14} /> Add field
            </button>
          )}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Exactly what the applicant&apos;s upload link shows, in this order.
        </p>
        <ol className="kyc-fields">
          {fields.map((f, i) => (
            <li key={i} className="kyc-field">
              <div className="grid-fields">
                <label className="field span-2">
                  <span className="field-label">Label</span>
                  <input
                    value={f.label}
                    disabled={ro}
                    onChange={(e) => setField(i, { label: e.target.value })}
                    onBlur={(e) => {
                      if (f.key.startsWith("new_")) setField(i, { key: uniqueKey(e.target.value, i) });
                    }}
                  />
                </label>
                <label className="field span-2">
                  <span className="field-label">Type</span>
                  <select
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
                <label className="field span-2">
                  <span className="field-label">Shown to</span>
                  <select
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
                  <label className="field span-3">
                    <span className="field-label">Document</span>
                    <select
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
                  <label className="field span-3">
                    <span className="field-label">Placeholder</span>
                    <input
                      value={f.placeholder}
                      disabled={ro}
                      onChange={(e) => setField(i, { placeholder: e.target.value })}
                    />
                  </label>
                )}
                <label className="field span-3">
                  <span className="field-label">Help text</span>
                  <input value={f.help} disabled={ro} onChange={(e) => setField(i, { help: e.target.value })} />
                </label>
                {f.type === "select" && (
                  <label className="field span-6">
                    <span className="field-label">Choices, one per line</span>
                    <textarea
                      rows={3}
                      value={f.options.join("\n")}
                      disabled={ro}
                      onChange={(e) => setField(i, { options: e.target.value.split("\n").filter((o) => o.trim()) })}
                    />
                  </label>
                )}
              </div>
              <div className="btn-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={f.required}
                    disabled={ro}
                    onChange={(e) => setField(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                {f.type === "text" && (
                  <label className="check-row">
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
                <span className="muted" style={{ fontSize: 12 }}>
                  key: {f.key}
                </span>
                {canEdit && (
                  <>
                    <button type="button" className="btn small ghost" onClick={() => move(i, -1)} disabled={i === 0}>
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => move(i, 1)}
                      disabled={i === fields.length - 1}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="btn small ghost"
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
            </li>
          ))}
        </ol>
      </section>

      <section className="panel panel-pad stack">
        <h3 className="section-title">Base KYC checks</h3>
        <div className="grid-fields">
          <label className="field span-3">
            <span className="field-label">IDs valid at least this many days after the lease starts</span>
            <input
              type="number"
              min={0}
              max={365}
              value={base.validityDays}
              disabled={ro}
              onChange={(e) => setBase({ ...base, validityDays: Number(e.target.value) })}
            />
          </label>
          <label className="field span-3">
            <span className="field-label">Minimum read confidence (0.5 to 1)</span>
            <input
              type="number"
              step={0.05}
              min={0.5}
              max={1}
              value={base.minConfidence}
              disabled={ro}
              onChange={(e) => setBase({ ...base, minConfidence: Number(e.target.value) })}
            />
          </label>
          <label className="field span-3">
            <span className="field-label">Applicant name vs documents</span>
            <select
              value={base.applicantName}
              disabled={ro}
              onChange={(e) => setBase({ ...base, applicantName: e.target.value as Base["applicantName"] })}
            >
              <option value="lenient">Allow middle names and order</option>
              <option value="exact">Exact</option>
              <option value="off">Don&apos;t check</option>
            </select>
          </label>
        </div>
        <div className="check-col">
          {BASE_SWITCHES.map((b) => (
            <label key={b.key} className="check-row">
              <input
                type="checkbox"
                checked={base[b.key] as boolean}
                disabled={ro}
                onChange={(e) => setBase({ ...base, [b.key]: e.target.checked })}
              />
              {b.label}
            </label>
          ))}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Expired documents, unreadable photos and wrong documents are always flagged.
        </p>
      </section>

      <section className="panel panel-pad stack">
        <div className="co-body-head">
          <h3 className="section-title">Company KYC rules</h3>
          {canEdit && (
            <select
              className="btn small"
              value=""
              onChange={(e) => {
                if (e.target.value) setRules((rs) => [...rs, newRule(e.target.value as Rule["type"], answerKeys)]);
              }}
            >
              <option value="">Add rule…</option>
              {Object.entries(RULE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </div>
        {rules.length === 0 && <p className="muted">No company rules. Only the base checks apply.</p>}
        {rules.map((r, i) => (
          <div key={r.id} className="kyc-field">
            <div className="grid-fields">
              <label className="field span-2">
                <span className="field-label">{RULE_LABEL[r.type]}</span>
                <input value={r.label} disabled={ro} onChange={(e) => setRule(i, { label: e.target.value })} />
              </label>
              {(r.type === "answer_matches_document" || r.type === "answer_required") && (
                <label className="field span-2">
                  <span className="field-label">Form answer</span>
                  <select
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
                <label className="field span-2">
                  <span className="field-label">Must match</span>
                  <select
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
                <label className="field span-2">
                  <span className="field-label">Accepted answers (optional, comma separated)</span>
                  <input
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
                <label className="field span-2">
                  <span className="field-label">Document</span>
                  <select
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
                <label className="field span-2">
                  <span className="field-label">For</span>
                  <select
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
                <label className="field span-2">
                  <span className="field-label">Years</span>
                  <input
                    type="number"
                    min={18}
                    max={100}
                    value={r.years}
                    disabled={ro}
                    onChange={(e) => setRule(i, { years: Number(e.target.value) })}
                  />
                </label>
              )}
              {r.type === "ai_check" && (
                <label className="field span-6">
                  <span className="field-label">Instruction</span>
                  <textarea
                    rows={2}
                    value={r.instruction}
                    disabled={ro}
                    placeholder="For example: the Emirates ID back should show an employer."
                    onChange={(e) => setRule(i, { instruction: e.target.value })}
                  />
                  <span className="hint">
                    The local AI can only send the application to a person; it never approves or rejects.
                  </span>
                </label>
              )}
            </div>
            {canEdit && (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
              >
                <IconTrash size={14} /> Remove rule
              </button>
            )}
          </div>
        ))}
      </section>

      {result.error && (
        <div className="alert" data-tone="bad" role="alert">
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
      {result.ok && (
        <p className="row-done">Saved as a new version. New uploads use it; earlier applications keep theirs.</p>
      )}
      {canEdit && (
        <div>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save form and rules"}
          </button>
        </div>
      )}
    </div>
  );
}
