"use client";

import { ActionForm } from "../../../../components/ui/action-form";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { type Emirate, EMIRATE_LABELS } from "@leasing/core";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { subtypesLabel } from "../../../../lib/portfolio";
import type { RuleResult } from "../../../../lib/portfolio";
import type {
  CompanyClauseView,
  CompanyRow,
  CompanyTemplatePanel,
  CompanyTemplateView,
  ContractRuleRow,
  SampleReview as SampleReviewData,
} from "../../../../lib/types";
import { ClauseReview, UploadSample } from "./clause-review";
import { approveSampleAction, renameTemplateAction, retireTemplateAction, retryTemplateAction } from "./actions";
import { ClauseItem, ClauseList } from "./clause-list";
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

/** The emirates a template may be used in (D68): "Dubai, Abu Dhabi" or "Any emirate". */
export const emiratesLabel = (list: readonly Emirate[]) =>
  list.length ? list.map((e) => EMIRATE_LABELS[e]).join(", ") : "Any emirate";

/** Which emirates a template is for: a badge on its card. */
export function EmirateBadge({ emirates }: { emirates: CompanyTemplateView["emirates"] }) {
  return (
    <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-muted">
      {emiratesLabel(emirates)}
    </span>
  );
}

function TemplateHead({ t }: { t: CompanyTemplateView }) {
  const fields = t.blanks.filter((b) => b.role === "field").length;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <b>Version {t.version}</b>
      <EmirateBadge emirates={t.emirates} />
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
  const replaces = review.replaces;
  const formId = `approve-sample-${company.id}`;
  // D68: ticked clauses join the rules that use this template (after the replaced versions' rules move to it).
  const onTemplate = rules.filter(
    (r) => r.templateId !== null && (replaces.includes(r.templateId) || r.templateId === template?.id),
  );
  const ruleLabel = onTemplate.length
    ? onTemplate.map((r) => `${subtypesLabel(r.subtypes)} · ${r.category}`).join("; ")
    : undefined;
  const blocked = (template?.blockers.length ?? 0) > 0;
  return (
    <div className="grid gap-3.5 rounded-card bg-raised p-4" id="sample-review">
      <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">
        Review the new version · for {emiratesLabel(review.emirates)}
      </h4>
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
            {template && (replaces.length > 0 || rulesToMove > 0) && (
              <span className="m-0 text-[12.5px] text-muted">
                {replaces.length > 0 ? "Replaces the version in use. " : ""}
                {rulesToMove > 0
                  ? `${rulesToMove} ${rulesToMove === 1 ? "rule moves" : "rules move"} to version ${template.version}.`
                  : ""}
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

/** D69: rename a named template (every version of it). */
function RenameTemplate({ companyId, familyId, name }: { companyId: string; familyId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: RuleResult, fd: FormData) => {
    const r = await renameTemplateAction(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, {});
  if (!open)
    return (
      <button type="button" className={BTN.ghost} onClick={() => setOpen(true)}>
        Rename
      </button>
    );
  return (
    <ActionForm state={state} action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="familyId" value={familyId} />
      <input
        name="name"
        defaultValue={name}
        maxLength={80}
        aria-label="Template name"
        className="h-9 w-64 max-w-full rounded-md border border-line bg-page px-2.5 text-sm text-ink"
      />
      <button type="submit" className={BTN.primary} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" className={BTN.ghost} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {state.error && (
        <span className="text-xs text-danger" role="alert">
          {state.error}
        </span>
      )}
    </ActionForm>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  retail: "Retail",
};

/** The active contract rules on one of the template's versions, each linking to its row on Settings → Contracts. */
function RulesUsing({ company, rules }: { company: CompanyRow; rules: ContractRuleRow[] }) {
  return (
    <section className="grid gap-2" aria-label="Rules using it">
      <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">Contract rules using it</h4>
      {rules.length === 0 ? (
        <p className="m-0 text-[12.5px] text-muted">
          None yet. Pick this template on a rule in{" "}
          <a className="text-ink! underline" href={`/settings/contracts?company=${company.id}`}>
            Contracts
          </a>
          .
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-1 p-0 text-[13px]">
          {rules.map((r) => (
            <li key={r.id}>
              <a
                className="text-ink! underline"
                href={`/settings/contracts?${new URLSearchParams({ company: company.id, category: r.category, emirate: r.emirate ?? "any" }).toString()}`}
              >
                {CATEGORY_LABEL[r.category] ?? r.category} · {r.emirate ? EMIRATE_LABELS[r.emirate] : "All emirates"} ·{" "}
                {subtypesLabel(r.subtypes)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * D69: one named template of a company (a tab on Contract templates): its name, the version in use, the sample being
 * read or reviewed for it, its clauses, the rules using it and its older versions. `"new"`: the form that starts a
 * new named template.
 */
export function CompanyTemplatePanelView({
  company,
  panel,
  canEdit,
  rules = [],
  sample,
  clauses = [],
  selected,
  latestTab,
  tabName,
}: {
  company: CompanyRow;
  panel: CompanyTemplatePanel;
  canEdit: boolean;
  /** The company's active contract rules (every category). */
  rules?: ContractRuleRow[];
  /** The latest sample's clause reading (shown on the tab of the template it belongs to). */
  sample?: SampleReviewData | null;
  /** The company's clauses (those of this template are listed here). */
  clauses?: CompanyClauseView[];
  /** The selected tab: a template's id, or `new`. */
  selected: string;
  /** The tab the company's latest sample belongs to. */
  latestTab: string | null;
  /** The selected tab's name (also for a template whose first version is still being read). */
  tabName: string;
}) {
  const router = useRouter();
  const here = latestTab !== null && latestTab === selected;
  const reading = here && panel.extraction?.status === "reading";
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [reading, router]);
  const [retryState, retry, retrying] = useActionState<RuleResult, FormData>(retryTemplateAction, {});
  if (selected === "new") {
    return (
      <section
        className="grid gap-3.5 rounded-card border border-line bg-page p-5"
        aria-label={`New contract template for ${company.name}`}
      >
        <h3 className="m-0 text-base font-semibold">New template</h3>
        <p className="m-0 text-[13px] text-muted">
          Give the template a name, choose the emirates it is for and upload a sample contract. The layout, fields and
          clauses are read from it for you to review. It sits next to the other templates; nothing else changes.
        </p>
        {canEdit ? (
          <UploadSample company={company} target={{ kind: "new" }} />
        ) : (
          <p className="m-0 text-[13px] text-muted">Only admins can add templates.</p>
        )}
      </section>
    );
  }
  const versions = panel.templates.filter((t) => t.familyId === selected);
  const ids = new Set(versions.map((t) => t.id));
  const proposed =
    here && panel.review?.templateId ? versions.find((t) => t.id === panel.review!.templateId) : undefined;
  const current = versions.find((t) => t.status === "approved");
  const rest = versions.filter((t) => t !== current && t !== proposed);
  const showReview = here && !!panel.review && (panel.review.clauses.length > 0 || !!proposed);
  const using = rules.filter((r) => r.templateId !== null && ids.has(r.templateId));
  const onRetired = using.filter((r) => versions.find((t) => t.id === r.templateId)?.status === "retired").length;
  const own = clauses.filter((c) => c.templateId && ids.has(c.templateId) && c.status === "approved");
  const latest = current ?? versions[0];
  return (
    <section
      className="grid gap-3.5 rounded-card border border-line bg-page p-5"
      aria-label={`Contract template ${tabName} for ${company.name}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="m-0 text-base font-semibold">{tabName}</h3>
        {current ? (
          <span className="inline-flex rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent">
            v{current.version} in use
          </span>
        ) : (
          <span className="text-xs font-semibold text-muted">No approved version yet</span>
        )}
        {latest && <EmirateBadge emirates={latest.emirates} />}
        {canEdit && versions.length > 0 && <RenameTemplate companyId={company.id} familyId={selected} name={tabName} />}
      </div>
      {canEdit && versions.length > 0 && (
        <UploadSample
          key={selected}
          company={company}
          target={{
            kind: "version",
            familyId: selected,
            emirates: latest?.emirates ?? [],
            replaces: current?.version ?? null,
          }}
        />
      )}
      {here && sample && (
        <ClauseReview
          companyId={company.id}
          review={sample}
          canEdit={canEdit}
          templateReady={sample.sample?.templateReady === true}
        />
      )}
      {onRetired > 0 && (
        <div className={ALERT.warn} role="alert">
          <IconWarning size={16} />
          <div>
            {onRetired} contract {onRetired === 1 ? "rule uses" : "rules use"} a retired version of this template.
            Contracts for {onRetired === 1 ? "it" : "them"} can&rsquo;t be prepared until a new version is approved or
            the rule is pointed at another template.
          </div>
        </div>
      )}
      {reading && (
        <ReadingProgress mins={panel.extraction?.minutes ?? null} limit={panel.extraction?.limitMinutes ?? null} />
      )}
      {here && (panel.extraction?.status === "failed" || (panel.extraction?.status === "retired" && !current)) && (
        <div className="grid gap-2">
          {panel.extraction.status === "failed" ? (
            <p className="text-xs text-danger" role="alert">
              We couldn&rsquo;t read the template from the sample:{" "}
              {panel.extraction.reasons.join(" ") || "an unexpected error"}
            </p>
          ) : (
            <p className="m-0 text-muted">
              The version read from the last sample was retired. Read the sample again to propose a new version, or
              upload another sample.
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
      {current && <TemplateCard t={current} canEdit={canEdit} />}
      {versions.length > 0 && (
        <ClauseList company={company} clauses={own} rules={rules} canEdit={canEdit} scope="template" />
      )}
      {versions.length > 0 && <RulesUsing company={company} rules={using} />}
      {rest.length > 0 && (
        <details className="grid gap-2.5 text-sm">
          <summary className="cursor-pointer text-[13.5px] text-muted">Older versions ({rest.length})</summary>
          <div className="grid gap-3">
            {rest.map((t) => (
              <details key={t.id} className="grid gap-2.5 text-sm">
                <summary className="cursor-pointer text-[13.5px] text-muted">
                  Version {t.version} ({emiratesLabel(t.emirates)}): {STATUS_LABEL[t.status]}
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
