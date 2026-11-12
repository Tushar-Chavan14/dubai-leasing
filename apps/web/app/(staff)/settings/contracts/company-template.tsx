"use client";

import { ActionForm } from "../../../../components/ui/action-form";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { EMIRATE_LABELS, EMIRATES } from "@leasing/core";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { subtypeLabel } from "../../../../lib/portfolio";
import type { RuleResult } from "../../../../lib/portfolio";
import type { CompanyRow, CompanyTemplatePanel, CompanyTemplateView, ContractRuleRow } from "../../../../lib/types";
import { approveSampleAction, retireTemplateAction, retryTemplateAction } from "./actions";
import { ClauseItem } from "./clause-list";
import { ALERT, BTN, CHECK_ROW, TABLE, TD, TH } from "../../../../components/ui/settings";

const STATUS_TONE = { proposed: "warn", approved: "good", retired: "quiet" } as const;
const STATUS_LABEL = { proposed: "Waiting for review", approved: "Approved", retired: "Retired" } as const;

function Errors({ state }: { state: RuleResult }) {
  if (!state.error) return null;
  return (
    <div className={ALERT.bad} role="alert">
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
    <section className="grid gap-3" aria-label="Fields">
      <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">Fields</h4>
      <p className="m-0 text-[12.5px] text-muted">
        Where the sample had a blank, each contract fills it from the records. The person approving each contract sees
        the result.
      </p>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className="group">
              <th className={TH}>Blank in the sample</th>
              <th className={TH}>Filled from</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((b) => {
              const empty = b.field === "leave_empty" || b.field === "unmapped";
              return (
                <tr key={b.id} className="group">
                  <td className={TD}>{b.label}</td>
                  <td className={TD}>
                    {empty ? (
                      <span className="text-muted">Printed empty, filled in by hand</span>
                    ) : (
                      (b.fieldLabel ?? b.field)
                    )}
                  </td>
                </tr>
              );
            })}
            {fields.length === 0 && (
              <tr className="group">
                <td colSpan={2} className={`${TD} text-muted`}>
                  None.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sigs > 0 && (
        <p className="m-0 text-[12.5px] text-muted">
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
    <section className="grid gap-3" aria-label="What we changed">
      <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">What we changed automatically</h4>
      <ul className="m-0 text-[12.5px] text-muted">
        {t.changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </section>
  );
}

/** Which emirate a template is for: a badge on its card. */
export function EmirateBadge({ emirate }: { emirate: CompanyTemplateView["emirate"] }) {
  return (
    <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-muted">
      {emirate ? EMIRATE_LABELS[emirate] : "Any emirate"}
    </span>
  );
}

function TemplateHead({ t }: { t: CompanyTemplateView }) {
  const fields = t.blanks.filter((b) => b.role === "field").length;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <b>Version {t.version}</b>
      <EmirateBadge emirate={t.emirate} />
      <span className="text-xs font-semibold" data-tone={STATUS_TONE[t.status]}>
        {STATUS_LABEL[t.status]}
      </span>
      <span className="text-muted">
        {t.sections.items.length} sections, {fields} {fields === 1 ? "field" : "fields"}
      </span>
      <a className={BTN.ghost} href={`/api/contract-templates/${t.id}/preview`} target="_blank" rel="noreferrer">
        Preview contract
      </a>
    </div>
  );
}

/** An approved or older template: its look is used as is; the fields it fills; Retire. */
function TemplateCard({ t, canEdit }: { t: CompanyTemplateView; canEdit: boolean }) {
  const [retireState, retire, retiring] = useActionState<RuleResult, FormData>(retireTemplateAction, {});
  return (
    <div className="grid gap-3.5 rounded-card bg-raised p-4" data-status={t.status}>
      <TemplateHead t={t} />
      <p className="m-0 text-[12.5px] text-muted">
        Contracts look like the sample: its layout, headings, wording and fields. Clause paragraphs print the clauses
        below, as they are now.
      </p>
      <Changes t={t} />
      <details>
        <summary className="cursor-pointer text-[13.5px] text-muted">
          Fields ({t.blanks.filter((b) => b.role === "field").length})
        </summary>
        <Fields t={t} />
      </details>
      {canEdit && t.status === "approved" && (
        <div className="grid gap-2">
          <Errors state={retireState} />
          <ActionForm state={retireState} action={retire} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="templateId" value={t.id} />
            <button type="submit" className={BTN.danger} disabled={retiring}>
              {retiring ? "Retiring…" : "Retire template"}
            </button>
            <span className="m-0 text-[12.5px] text-muted">
              Contract rules that use it stop preparing contracts until they point at another template.
            </span>
          </ActionForm>
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
    <div className="grid gap-3.5 rounded-card bg-raised p-4" id="sample-review">
      <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">Review the sample</h4>
      {review.clauses.length > 0 && (
        <section className="grid gap-3" aria-label="Clauses">
          <p className="m-0 text-[12.5px] text-muted">
            Clauses read from the sample. Edit any wording or leave a clause out; untick one to keep it out of the rule
            (you can add it later).
          </p>
          <ul className="m-0 list-none p-0">
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
            <div className={ALERT.bad} role="alert">
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
          <p className="m-0 text-muted">
            The template (layout and fields) is still being read. Approve all now approves the clauses; the template
            follows when it is ready.
          </p>
        )
      )}
      {canEdit && (
        <ActionForm state={state} id={formId} action={approve} className="grid gap-2">
          <input type="hidden" name="companyId" value={company.id} />
          <Errors state={state} />
          {review.needsCheck && (
            <label className={CHECK_ROW}>
              <input type="checkbox" name="checked" />I checked the amounts, dates and DLD/RERA references
              {template?.hasLogo ? ", and the logo is our company's own" : ""}.
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN.primary} disabled={approving || blocked}>
              {approving ? "Approving…" : "Approve all"}
            </button>
            {template && rulesToMove > 0 && (
              <span className="m-0 text-[12.5px] text-muted">
                {rulesToMove} {rulesToMove === 1 ? "rule moves" : "rules move"} to version {template.version}.
              </span>
            )}
          </div>
        </ActionForm>
      )}
    </div>
  );
}

/** Where a template reading has got to: the text and layout are read in seconds; the model step is the slow part. */
function ReadingProgress({ mins, limit }: { mins: number | null; limit: number | null }) {
  const step = 1;
  const steps = [
    "Reading the text and layout of the PDF",
    "Asking the model to find the sections, blanks and look",
    "Saving the proposed version",
  ];
  return (
    <div className="grid gap-1" aria-live="polite">
      <p className="m-0 text-muted">
        Reading the sample contract&hellip;{mins !== null && ` started ${mins === 0 ? "just now" : `${mins} min ago`}.`}
      </p>
      <ol className="m-0 grid list-none gap-0.5 p-0 text-[13px] text-muted [&_li[data-state=current]]:font-semibold [&_li[data-state=current]]:text-ink">
        {steps.map((label, i) => (
          <li key={label} data-state={i < step ? "done" : i === step ? "current" : "todo"}>
            {i < step ? "✓ " : i === step ? "… " : ""}
            {label}
          </li>
        ))}
      </ol>
      <p className="m-0 text-muted">
        This usually takes about 5 minutes on this machine
        {limit ? `; if the model hasn't finished after ${limit} minutes it stops and says why` : ""}.
      </p>
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
  // One group per emirate ("any emirate" first): its template in use and its other versions (D56).
  const groups = [null, ...EMIRATES]
    .map((emirate) => {
      const all = panel.templates.filter((t) => t.emirate === emirate);
      const inUse = all.find((t) => t.status === "approved");
      return { emirate, inUse, rest: all.filter((t) => t !== inUse && t !== proposed) };
    })
    .filter((g) => g.inUse || g.rest.length > 0);
  const showReview = !!panel.review && (panel.review.clauses.length > 0 || !!proposed);
  return (
    <section
      className="grid gap-3.5 rounded-card border border-line bg-page p-5"
      aria-label={`Company template for ${company.name}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="m-0 text-base font-semibold">Company template: {company.name}</h3>
        {groups.flatMap((g) =>
          g.inUse
            ? [
                <span
                  key={g.emirate ?? "any"}
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${"bg-accent text-on-accent"}`}
                >
                  {g.emirate ? EMIRATE_LABELS[g.emirate] : "Any emirate"}: version {g.inUse.version} in use
                </span>,
              ]
            : [],
        )}
      </div>
      {panel.rulesOnRetired > 0 && (
        <div className={ALERT.warn} role="alert">
          <IconWarning size={16} />
          <div>
            {panel.rulesOnRetired} contract {panel.rulesOnRetired === 1 ? "rule uses" : "rules use"} a retired template.
            Contracts for {panel.rulesOnRetired === 1 ? "it" : "them"} can&rsquo;t be prepared until a new version is
            approved or the rule is pointed at another template.
          </div>
        </div>
      )}
      {reading && (
        <ReadingProgress mins={panel.extraction?.minutes ?? null} limit={panel.extraction?.limitMinutes ?? null} />
      )}
      {(panel.extraction?.status === "failed" || panel.extraction?.status === "retired") && (
        <div className="grid gap-2">
          {panel.extraction.status === "failed" ? (
            <p className="text-xs text-danger" role="alert">
              We couldn&rsquo;t read the template from the sample:{" "}
              {panel.extraction.reasons.join(" ") || "an unexpected error"}
            </p>
          ) : (
            <p className="m-0 text-muted">
              The template read from this sample was retired. Read the sample again to propose a new version, or upload
              another sample.
            </p>
          )}
          {canEdit && (
            <ActionForm state={retryState} action={retry} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="companyId" value={company.id} />
              <button type="submit" className={BTN.ghost} disabled={retrying}>
                {retrying ? "Starting…" : panel.extraction.status === "failed" ? "Try again" : "Read the sample again"}
              </button>
              {retryState.error && (
                <span className="text-xs text-danger" role="alert">
                  {retryState.error}
                </span>
              )}
            </ActionForm>
          )}
        </div>
      )}
      {panel.templates.length === 0 && !reading && !showReview && panel.extraction?.status !== "failed" && (
        <p className="m-0 text-muted">
          No company template yet. Upload a sample contract on one of this company&rsquo;s rules.
        </p>
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
      {groups.map((g) => (
        <div key={g.emirate ?? "any"} className="grid gap-3">
          {g.inUse && <TemplateCard t={g.inUse} canEdit={canEdit} />}
          {g.rest.length > 0 && (
            <details className="grid gap-2.5 text-sm">
              <summary className="cursor-pointer text-[13.5px] text-muted">
                Other versions, {g.emirate ? EMIRATE_LABELS[g.emirate] : "any emirate"} ({g.rest.length})
              </summary>
              <div className="grid gap-3">
                {g.rest.map((t) => (
                  <details key={t.id} className="grid gap-2.5 text-sm">
                    <summary className="cursor-pointer text-[13.5px] text-muted">
                      Version {t.version}: {STATUS_LABEL[t.status]}
                    </summary>
                    <TemplateCard t={t} canEdit={canEdit} />
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>
      ))}
    </section>
  );
}
