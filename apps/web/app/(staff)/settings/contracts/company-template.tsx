"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { IconWarning } from "../../../../lib/icons";
import type { RuleResult } from "../../../../lib/portfolio";
import type { CompanyRow, CompanyTemplatePanel, CompanyTemplateView } from "../../../../lib/types";
import {
  approveTemplateAction,
  resuggestTemplateAction,
  retireTemplateAction,
  retryTemplateAction,
  reviewTemplateAction,
} from "./actions";

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

/** A checkbox that saves as soon as it changes (a review decision on a proposed template). */
function Toggle({
  templateId,
  toggle,
  paragraphKey,
  checked,
  disabled,
  children,
}: {
  templateId: string;
  toggle:
    | "dropHeader"
    | "dropFooter"
    | "dropLogo"
    | "logoConfirmed"
    | "authorityChecked"
    | "valuesConfirmed"
    | "authorityBodyConfirmed"
    | "droppedParagraphs";
  paragraphKey?: string;
  checked: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [state, act, pending] = useActionState<RuleResult, FormData>(reviewTemplateAction, {});
  return (
    <form ref={form} action={act}>
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="toggle" value={toggle} />
      {paragraphKey && <input type="hidden" name="key" value={paragraphKey} />}
      <label className="check-row">
        <input
          type="checkbox"
          name="on"
          defaultChecked={checked}
          key={String(checked)}
          disabled={disabled || pending}
          onChange={() => form.current?.requestSubmit()}
        />
        {children}
      </label>
      {state.error && (
        <span className="err" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

const SOURCE_LABEL = {
  matched: "Matched by the label",
  model: "Suggested by the model",
  empty: "Left empty (filled by hand)",
  admin: "Matched by the label",
} as const;

/** Read only: which record data fills a blank and how it was chosen. Mappings are made by code and the model. */
function FieldSource({ blank }: { blank: CompanyTemplateView["blanks"][number] }) {
  const empty = blank.field === "leave_empty" || blank.field === "unmapped";
  return (
    <div className="tpl-field">
      <span>{empty ? "Leave empty (filled by hand)" : (blank.fieldLabel ?? blank.field)}</span>
      {blank.source && (
        <span className="muted tpl-note" data-source={blank.source}>
          {SOURCE_LABEL[blank.source]}
        </span>
      )}
      {blank.note && <span className="muted tpl-note">{blank.note}</span>}
    </div>
  );
}

/** Section wording with each blank shown as its label in a chip (the wording itself is read only). */
function Wording({ text, t }: { text: string; t: CompanyTemplateView }) {
  const byId = new Map(t.blanks.map((b) => [b.id, b]));
  return (
    <>
      {text.split(/(\{\{b\d+\}\})/).map((part, i) => {
        const m = /^\{\{(b\d+)\}\}$/.exec(part);
        if (!m) return part;
        const b = byId.get(m[1]!);
        const unmapped = b?.role === "field" && (b.field === "unmapped" || b.field === "leave_empty");
        return (
          <span
            key={`${m[1]}-${i}`}
            className="tpl-blank"
            data-state={b?.role === "signature" ? "sig" : unmapped ? "empty" : "ok"}
          >
            {b?.role === "signature" ? "signature line" : (b?.label ?? m[1])}
          </span>
        );
      })}
    </>
  );
}

function BlankTable({ rows }: { rows: CompanyTemplateView["blanks"] }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Blank</th>
            <th>Where it is</th>
            <th>Filled from</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>{b.label}</td>
              <td className="muted tpl-ctx">
                {b.before.slice(-60)}
                <span className="tpl-blank" data-state="ok">
                  {b.marker.slice(0, 6) || "blank"}
                </span>
                {b.after.slice(0, 30)}
              </td>
              <td>
                {b.role === "signature" ? (
                  <span className="muted">Signature line (never a field)</span>
                ) : (
                  <FieldSource blank={b} />
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                None.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TemplateCard({ t, canEdit, rulesToMove }: { t: CompanyTemplateView; canEdit: boolean; rulesToMove: number }) {
  const [approveState, approve, approving] = useActionState<RuleResult, FormData>(approveTemplateAction, {});
  const [resuggestState, resuggest, resuggesting] = useActionState<RuleResult, FormData>(resuggestTemplateAction, {});
  const [retireState, retire, retiring] = useActionState<RuleResult, FormData>(retireTemplateAction, {});
  const editable = canEdit && t.status === "proposed";
  const flags = t.style.flags;
  const fields = t.blanks.filter((b) => b.role === "field");
  const sigs = t.blanks.length - fields.length;
  return (
    <div className="tpl-card stack" data-status={t.status}>
      <div className="tpl-head">
        <b>Version {t.version}</b>
        <span className="status" data-tone={STATUS_TONE[t.status]}>
          {STATUS_LABEL[t.status]}
        </span>
        <span className="muted">
          {t.sections.items.length} sections, {fields.length} {fields.length === 1 ? "field" : "fields"} to fill
          {sigs ? `, ${sigs} signature ${sigs === 1 ? "line" : "lines"}` : ""}
        </span>
        <a className="btn small" href={`/api/contract-templates/${t.id}/preview`} target="_blank" rel="noreferrer">
          Preview contract
        </a>
      </div>

      {flags.authorityMarks && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          <div>
            <strong>This sample has DLD or Ejari marks.</strong> Found in:{" "}
            {flags.areas.map((a) => (a === "logo_area" ? "the logo area" : `the ${a}`)).join(", ")}. They are never
            reused. Drop the {flags.areas.map((a) => (a === "logo_area" ? "logo" : a)).join(", ")} below to approve; the
            contract then uses no header, footer or logo and a neutral accent colour.
          </div>
        </div>
      )}
      {flags.authorityMarks && flags.areas.length === 0 && (
        <Toggle templateId={t.id} toggle="authorityChecked" checked={t.review.authorityChecked} disabled={!editable}>
          I checked the contract wording for authority marks
        </Toggle>
      )}
      {t.status === "proposed" && t.problems.length > 0 && (
        <div className="alert" data-tone="warn">
          <IconWarning size={16} />
          <div>
            <strong>Before this can be approved</strong>
            <ul>
              {t.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {t.paragraphs.length > 0 && (
        <section className="stack" aria-label="Wording to confirm">
          <h4 className="tpl-h">Wording to confirm</h4>
          <p className="muted tpl-note">
            Wording with numbers, periods, dates or amounts goes into every contract as written. Confirm each one, or
            upload a sample without it.
          </p>
          {t.paragraphs.map((p) => {
            const dropped = t.review.droppedParagraphs.includes(p.key);
            const blocked = p.fixedValues.length > 0 || p.sampleOnly;
            return (
              <div key={p.key} className="stack" style={dropped ? { opacity: 0.55 } : undefined}>
                <p className="tpl-para">
                  <Wording text={p.text} t={t} />
                </p>
                {p.warning && (
                  <span className="muted" role="note">
                    {p.warning}
                  </span>
                )}
                {p.fixedValues.length > 0 && !dropped && (
                  <span className="err" role="alert">
                    Contains {p.fixedValues.join(", ")} from the sample. That can&rsquo;t be fixed wording: it has to be
                    a blank.
                  </span>
                )}
                {p.sampleOnly && !dropped && (
                  <span className="err" role="alert">
                    A note about the sample itself, not contract wording.
                  </span>
                )}
                {p.values && !blocked && (
                  <Toggle
                    templateId={t.id}
                    toggle="valuesConfirmed"
                    paragraphKey={p.key}
                    checked={t.review.valuesConfirmed.includes(p.key)}
                    disabled={!editable}
                  >
                    Confirm
                  </Toggle>
                )}
                {p.authority && !blocked && (
                  <Toggle
                    templateId={t.id}
                    toggle="authorityBodyConfirmed"
                    paragraphKey={p.key}
                    checked={t.review.authorityBodyConfirmed.includes(p.key)}
                    disabled={!editable}
                  >
                    Neutral reference, not branding
                  </Toggle>
                )}
                {p.kind === "paragraph" && (blocked || dropped) && (
                  <Toggle
                    templateId={t.id}
                    toggle="droppedParagraphs"
                    paragraphKey={p.key}
                    checked={dropped}
                    disabled={!editable}
                  >
                    Drop this line
                  </Toggle>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="stack" aria-label="Sections">
        <h4 className="tpl-h">Sections</h4>
        <p className="muted tpl-note">
          The wording is copied from the sample and can&rsquo;t be edited here. To change it, upload a new sample.
        </p>
        <div className="tpl-sections">
          {t.sections.title && (
            <p className="tpl-title">
              <Wording text={t.sections.title} t={t} />
            </p>
          )}
          {t.sections.items.map((s) => (
            <div key={s.id} className="tpl-section">
              {s.heading && (
                <p className="tpl-sec-head">
                  {s.number ? `${s.number} ` : ""}
                  <Wording text={s.heading} t={t} />
                </p>
              )}
              {s.paragraphs.map((p, i) => (
                <p key={`${s.id}-${i}`} className="tpl-para">
                  <Wording text={p} t={t} />
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="stack" aria-label="Blanks">
        <h4 className="tpl-h">Fields to fill</h4>
        <BlankTable rows={t.blanks.filter((b) => b.role !== "signature")} />
        {t.blanks.some((b) => b.role === "signature") && (
          <details>
            <summary>Signature lines (filled at signing)</summary>
            <BlankTable rows={t.blanks.filter((b) => b.role === "signature")} />
          </details>
        )}
      </section>

      <section className="stack" aria-label="Style">
        <h4 className="tpl-h">Look</h4>
        <div className="tpl-style">
          <div className="tpl-swatch">
            <span className="tpl-aa" data-font={t.style.font.family} aria-hidden="true">
              Aa
            </span>
            <span>
              {t.style.font.family === "serif" ? "Serif" : "Sans-serif"} font, {t.style.sizes.bodyPt} pt body
            </span>
          </div>
          <div className="tpl-swatch">
            <span
              className="tpl-colour"
              style={t.style.accentColour ? { background: t.style.accentColour } : undefined}
              data-neutral={t.style.accentColour ? undefined : "true"}
              aria-hidden="true"
            />
            <span>
              {t.style.accentColour ? `Accent ${t.style.accentColour}` : "Neutral accent colour"}
              {flags.authorityMarks && " (marks found, so the neutral colour is used)"}
            </span>
          </div>
          <div className="tpl-swatch">
            <span>
              Page {Math.round(t.style.page.widthPt)} x {Math.round(t.style.page.heightPt)} pt
            </span>
          </div>
        </div>
        <div className="tpl-hf">
          <div>
            <span className="field-label">Header</span>
            <p className="tpl-text">{t.style.header ?? <span className="muted">None found</span>}</p>
            {(t.style.header !== null || flags.areas.includes("header")) && (
              <Toggle templateId={t.id} toggle="dropHeader" checked={t.review.dropHeader} disabled={!editable}>
                Drop
              </Toggle>
            )}
          </div>
          <div>
            <span className="field-label">Footer</span>
            <p className="tpl-text">{t.style.footer ?? <span className="muted">None found</span>}</p>
            {(t.style.footer !== null || flags.areas.includes("footer")) && (
              <Toggle templateId={t.id} toggle="dropFooter" checked={t.review.dropFooter} disabled={!editable}>
                Drop
              </Toggle>
            )}
          </div>
        </div>
        {t.hasLogo && (
          <div className="tpl-logo">
            <span className="field-label">Logo</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/contract-templates/${t.id}/logo`}
              alt="Logo read from the sample"
              className="tpl-logo-img"
              data-dropped={t.review.dropLogo ? "true" : undefined}
            />
            <Toggle
              templateId={t.id}
              toggle="logoConfirmed"
              checked={t.review.logoConfirmed}
              disabled={!editable || t.review.dropLogo}
            >
              This is our company&rsquo;s logo (not DLD or a government mark)
            </Toggle>
            <Toggle templateId={t.id} toggle="dropLogo" checked={t.review.dropLogo} disabled={!editable}>
              Drop logo
            </Toggle>
          </div>
        )}
      </section>

      {canEdit && t.status === "proposed" && (
        <div className="stack" style={{ gap: 8 }}>
          <Errors state={approveState} />
          <Errors state={resuggestState} />
          <form action={resuggest} className="btn-row">
            <input type="hidden" name="templateId" value={t.id} />
            <button type="submit" className="btn" disabled={resuggesting}>
              {resuggesting ? "Choosing…" : "Re-suggest mappings"}
            </button>
            <span className="muted tpl-note">
              Mappings are chosen by the label rules and the model. Blanks with no clear match print as an empty line.
            </span>
          </form>
          <form action={approve} className="btn-row">
            <input type="hidden" name="templateId" value={t.id} />
            <button type="submit" className="btn primary" disabled={approving || t.problems.length > 0}>
              {approving
                ? "Approving…"
                : rulesToMove > 0
                  ? `Approve template (${rulesToMove} ${rulesToMove === 1 ? "rule" : "rules"} will move to v${t.version})`
                  : "Approve template"}
            </button>
          </form>
        </div>
      )}
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

/** Where a template reading has got to: the text and layout are read in seconds; the model step is the slow part. */
function ReadingProgress({ mins }: { mins: number | null }) {
  // The page refreshes every few seconds while reading, so the elapsed time (from the engine) stays current.
  // The text and layout are read in seconds, so the model step is the one in progress.
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

/** The "Company template" panel for one company: reading status, versions, review and approval. */
export function CompanyTemplatePanelView({
  company,
  panel,
  canEdit,
}: {
  company: CompanyRow;
  panel: CompanyTemplatePanel;
  canEdit: boolean;
}) {
  const router = useRouter();
  const reading = panel.extraction?.status === "reading";
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [reading, router]);
  const [retryState, retry, retrying] = useActionState<RuleResult, FormData>(retryTemplateAction, {});
  const open =
    panel.templates.find((t) => t.status === "proposed") ?? panel.templates.find((t) => t.status === "approved");
  const rest = panel.templates.filter((t) => t !== open);
  return (
    <section className="panel panel-pad stack" aria-label={`Company template for ${company.name}`} aria-live="polite">
      <div className="tpl-head">
        <h3 className="tpl-company">Company template: {company.name}</h3>
        {panel.templates.find((t) => t.status === "approved") && (
          <span className="status" data-tone="good">
            Version {panel.templates.find((t) => t.status === "approved")!.version} in use
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
      {panel.extraction?.status === "retired" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted">
            The template read from this sample was retired. Read the sample again to propose a new version, or upload
            another sample.
          </p>
          {canEdit && (
            <form action={retry} className="btn-row">
              <input type="hidden" name="companyId" value={company.id} />
              <button type="submit" className="btn small" disabled={retrying}>
                Read the sample again
              </button>
            </form>
          )}
        </div>
      )}
      {panel.extraction?.status === "failed" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="err" role="alert">
            We couldn&rsquo;t read the template from the sample:{" "}
            {panel.extraction.reasons.join(" ") || "an unexpected error"}
          </p>
          {canEdit && (
            <form action={retry} className="btn-row">
              <input type="hidden" name="companyId" value={company.id} />
              <button type="submit" className="btn small" disabled={retrying}>
                Try again
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
      {panel.templates.length === 0 && !reading && panel.extraction?.status !== "failed" && (
        <p className="muted">No company template yet. Upload a sample contract on one of this company&rsquo;s rules.</p>
      )}
      {open && <TemplateCard t={open} canEdit={canEdit} rulesToMove={panel.rulesToMove} />}
      {rest.length > 0 && (
        <details className="tpl-older">
          <summary>Other versions ({rest.length})</summary>
          <div className="stack">
            {rest.map((t) => (
              <details key={t.id} className="tpl-older-one">
                <summary>
                  Version {t.version}: {STATUS_LABEL[t.status]}
                </summary>
                <TemplateCard t={t} canEdit={canEdit} rulesToMove={panel.rulesToMove} />
              </details>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
