"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { IconWarning } from "../../../../lib/icons";
import { subtypeLabel } from "../../../../lib/portfolio";
import type { RuleResult } from "../../../../lib/portfolio";
import type { CompanyRow, CompanyTemplatePanel, CompanyTemplateView, ContractRuleRow } from "../../../../lib/types";
import { approveSampleAction, retireTemplateAction, retryTemplateAction } from "./actions";
import { ClauseItem } from "./clause-list";

const STATUS_TONE = { proposed: "warn", approved: "good", retired: "quiet" } as const;
const STATUS_LABEL = { proposed: "Waiting for review", approved: "Approved", retired: "Retired" } as const;

function Errors({ state }: { state: RuleResult }) {
  if (!state.error) return null;
  return (
    <div className="alert" data-tone="bad" role="alert">
      <IconWarning size={16} />
      <div>
        <strong>{state.error}</strong>
        {state.reasons && state.reasons.length > 0 && (
          <ul>
            {state.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Read only: each blank of the sample and the record it is filled from (D47: nothing to decide here). */
function Fields({ t }: { t: CompanyTemplateView }) {
  const fields = t.blanks.filter((b) => b.role === "field");
  const sigs = t.blanks.length - fields.length;
  return (
    <section className="stack" aria-label="Fields">
      <h4 className="tpl-h">Fields</h4>
      <p className="muted tpl-note">
        Where the sample had a blank, each contract fills it from the records. The person approving each contract sees
        the result.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Blank in the sample</th>
              <th>Filled from</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((b) => {
              const empty = b.field === "leave_empty" || b.field === "unmapped";
              return (
                <tr key={b.id}>
                  <td>{b.label}</td>
                  <td>
                    {empty ? (
                      <span className="muted">Printed empty, filled in by hand</span>
                    ) : (
                      (b.fieldLabel ?? b.field)
                    )}
                  </td>
                </tr>
              );
            })}
            {fields.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  None.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sigs > 0 && (
        <p className="muted tpl-note">
          {sigs} signature {sigs === 1 ? "line" : "lines"}, signed in the portal.
        </p>
      )}
    </section>
  );
}

/** What code changed on its own (marked header or footer removed, sample notes and values left out). */
function Changes({ t }: { t: CompanyTemplateView }) {
  if (t.changes.length === 0) return null;
  return (
    <section className="stack" aria-label="What we changed">
      <h4 className="tpl-h">What we changed automatically</h4>
      <ul className="muted tpl-note">
        {t.changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </section>
  );
}

function TemplateHead({ t }: { t: CompanyTemplateView }) {
  const fields = t.blanks.filter((b) => b.role === "field").length;
  return (
    <div className="tpl-head">
      <b>Version {t.version}</b>
      <span className="status" data-tone={STATUS_TONE[t.status]}>
        {STATUS_LABEL[t.status]}
      </span>
      <span className="muted">
        {t.sections.items.length} sections, {fields} {fields === 1 ? "field" : "fields"}
      </span>
      <a className="btn small" href={`/api/contract-templates/${t.id}/preview`} target="_blank" rel="noreferrer">
        Preview contract
      </a>
    </div>
  );
}

/** An approved or older template: its look is used as is; the fields it fills; Retire. */
function TemplateCard({ t, canEdit }: { t: CompanyTemplateView; canEdit: boolean }) {
  const [retireState, retire, retiring] = useActionState<RuleResult, FormData>(retireTemplateAction, {});
  return (
    <div className="tpl-card stack" data-status={t.status}>
      <TemplateHead t={t} />
      <p className="muted tpl-note">
        Contracts look like the sample: its layout, headings, wording and fields. Clause paragraphs print the clauses
        below, as they are now.
      </p>
      <Changes t={t} />
      <details>
        <summary>Fields ({t.blanks.filter((b) => b.role === "field").length})</summary>
        <Fields t={t} />
      </details>
      {canEdit && t.status === "approved" && (
        <div className="stack" style={{ gap: 8 }}>
          <Errors state={retireState} />
          <form action={retire} className="btn-row">
            <input type="hidden" name="templateId" value={t.id} />
            <button type="submit" className="btn danger" disabled={retiring}>
              {retiring ? "Retiring…" : "Retire template"}
            </button>
            <span className="muted tpl-note">
              Contract rules that use it stop preparing contracts until they point at another template.
            </span>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * D47 sample review: the clauses read from the latest sample (edit or leave out each one, tick which join the rule)
 * and the template's fields, approved together with one "Approve all".
 */
function SampleReview({
  company,
  review,
  template,
  reading,
  rules,
  rulesToMove,
  canEdit,
}: {
  company: CompanyRow;
  review: NonNullable<CompanyTemplatePanel["review"]>;
  template: CompanyTemplateView | null;
  reading: boolean;
  rules: ContractRuleRow[];
  rulesToMove: number;
  canEdit: boolean;
}) {
  const [state, approve, approving] = useActionState<RuleResult, FormData>(approveSampleAction, {});
  const formId = `approve-sample-${company.id}`;
  const rule =
    rules.find((r) => r.id === review.ruleId) ?? rules.find((r) => r.sampleDocumentId === review.sampleDocumentId);
  const ruleLabel = rule ? `${subtypeLabel(rule.subtype)} · ${rule.category}` : undefined;
  const blocked = (template?.blockers.length ?? 0) > 0;
  return (
    <div className="tpl-card stack" id="sample-review">
      <h4 className="tpl-h">Review the sample</h4>
      {review.clauses.length > 0 && (
        <section className="stack" aria-label="Clauses">
          <p className="muted tpl-note">
            Clauses read from the sample. Edit any wording or leave a clause out; untick one to keep it out of the rule
            (you can add it later).
          </p>
          <ul className="clause-items">
            {review.clauses.map((c) => (
              <ClauseItem
                key={c.id}
                c={c}
                canEdit={canEdit}
                {...(canEdit ? { approveFormId: formId } : {})}
                {...(ruleLabel ? { ruleLabel } : {})}
              />
            ))}
          </ul>
        </section>
      )}
      {template ? (
        <>
          <TemplateHead t={template} />
          <Changes t={template} />
          <Fields t={template} />
          {blocked && (
            <div className="alert" data-tone="bad" role="alert">
              <IconWarning size={16} />
              <div>
                {template.blockers.map((b) => (
                  <p key={b}>{b}</p>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        reading && (
          <p className="muted">
            The template (layout and fields) is still being read. Approve all now approves the clauses; the template
            follows when it is ready.
          </p>
        )
      )}
      {canEdit && (
        <form id={formId} action={approve} className="stack" style={{ gap: 8 }}>
          <input type="hidden" name="companyId" value={company.id} />
          <Errors state={state} />
          {review.needsCheck && (
            <label className="check-row">
              <input type="checkbox" name="checked" />I checked the amounts, dates and DLD/RERA references
              {template?.hasLogo ? ", and the logo is our company's own" : ""}.
            </label>
          )}
          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={approving || blocked}>
              {approving ? "Approving…" : "Approve all"}
            </button>
            {template && rulesToMove > 0 && (
              <span className="muted tpl-note">
                {rulesToMove} {rulesToMove === 1 ? "rule moves" : "rules move"} to version {template.version}.
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/** Where a template reading has got to: the text and layout are read in seconds; the model step is the slow part. */
function ReadingProgress({ mins }: { mins: number | null }) {
  const step = 1;
  const steps = [
    "Reading the text and layout of the PDF",
    "Asking the model to find the sections, blanks and look",
    "Saving the proposed version",
  ];
  return (
    <div className="stack" style={{ gap: 4 }} aria-live="polite">
      <p className="muted">
        Reading the sample contract&hellip;{mins !== null && ` started ${mins === 0 ? "just now" : `${mins} min ago`}.`}
      </p>
      <ol className="muted tpl-steps">
        {steps.map((label, i) => (
          <li key={label} data-state={i < step ? "done" : i === step ? "current" : "todo"}>
            {i < step ? "✓ " : i === step ? "… " : ""}
            {label}
          </li>
        ))}
      </ol>
      <p className="muted">This usually takes about 5 minutes on this machine; it stops itself after 15.</p>
    </div>
  );
}

/** The "Company template" panel for one company: reading status, the sample review, the template in use. */
export function CompanyTemplatePanelView({
  company,
  panel,
  canEdit,
  rules = [],
}: {
  company: CompanyRow;
  panel: CompanyTemplatePanel;
  canEdit: boolean;
  rules?: ContractRuleRow[];
}) {
  const router = useRouter();
  const reading = panel.extraction?.status === "reading";
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [reading, router]);
  const [retryState, retry, retrying] = useActionState<RuleResult, FormData>(retryTemplateAction, {});
  const proposed = panel.review?.templateId
    ? panel.templates.find((t) => t.id === panel.review!.templateId)
    : undefined;
  const inUse = panel.templates.find((t) => t.status === "approved");
  const rest = panel.templates.filter((t) => t !== inUse && t !== proposed);
  const showReview = !!panel.review && (panel.review.clauses.length > 0 || !!proposed);
  return (
    <section className="panel panel-pad stack" aria-label={`Company template for ${company.name}`} aria-live="polite">
      <div className="tpl-head">
        <h3 className="tpl-company">Company template: {company.name}</h3>
        {inUse && (
          <span className="status" data-tone="good">
            Version {inUse.version} in use
          </span>
        )}
      </div>
      {panel.rulesOnRetired > 0 && (
        <div className="alert" data-tone="warn" role="alert">
          <IconWarning size={16} />
          <div>
            {panel.rulesOnRetired} contract {panel.rulesOnRetired === 1 ? "rule uses" : "rules use"} a retired template.
            Contracts for {panel.rulesOnRetired === 1 ? "it" : "them"} can&rsquo;t be prepared until a new version is
            approved or the rule is pointed at another template.
          </div>
        </div>
      )}
      {reading && <ReadingProgress mins={panel.extraction?.minutes ?? null} />}
      {(panel.extraction?.status === "failed" || panel.extraction?.status === "retired") && (
        <div className="stack" style={{ gap: 8 }}>
          {panel.extraction.status === "failed" ? (
            <p className="err" role="alert">
              We couldn&rsquo;t read the template from the sample:{" "}
              {panel.extraction.reasons.join(" ") || "an unexpected error"}
            </p>
          ) : (
            <p className="muted">
              The template read from this sample was retired. Read the sample again to propose a new version, or upload
              another sample.
            </p>
          )}
          {canEdit && (
            <form action={retry} className="btn-row">
              <input type="hidden" name="companyId" value={company.id} />
              <button type="submit" className="btn small" disabled={retrying}>
                {retrying ? "Starting…" : panel.extraction.status === "failed" ? "Try again" : "Read the sample again"}
              </button>
              {retryState.error && (
                <span className="err" role="alert">
                  {retryState.error}
                </span>
              )}
            </form>
          )}
        </div>
      )}
      {panel.templates.length === 0 && !reading && !showReview && panel.extraction?.status !== "failed" && (
        <p className="muted">No company template yet. Upload a sample contract on one of this company&rsquo;s rules.</p>
      )}
      {showReview && (
        <SampleReview
          company={company}
          review={panel.review!}
          template={proposed ?? null}
          reading={reading}
          rules={rules}
          rulesToMove={panel.rulesToMove}
          canEdit={canEdit}
        />
      )}
      {inUse && <TemplateCard t={inUse} canEdit={canEdit} />}
      {rest.length > 0 && (
        <details className="tpl-older">
          <summary>Other versions ({rest.length})</summary>
          <div className="stack">
            {rest.map((t) => (
              <details key={t.id} className="tpl-older-one">
                <summary>
                  Version {t.version}: {STATUS_LABEL[t.status]}
                </summary>
                <TemplateCard t={t} canEdit={canEdit} />
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
