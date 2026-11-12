import { ArrowsLeftRightIcon as IconSwap } from "@phosphor-icons/react/dist/ssr";

export interface TemplateRewrite {
  key: string;
  before: string;
  after: string;
  reason: string;
}

/** Shows `{{b12}}` blanks as a neutral marker: the value is filled from the records when the PDF is made. */
const show = (s: string) => s.replace(/\{\{b\d+\}\}/g, "[from the records]");

/**
 * D64: template wording the contract agent reworded from the unit's records, old and new side by side. Code checked
 * every number against the unit; the person approving the contract reads it here.
 */
export function TemplateRewrites({ rewrites }: { rewrites: readonly TemplateRewrite[] }) {
  if (!rewrites.length) return null;
  return (
    <section aria-label="Reworded from the records" className="grid gap-2">
      <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
        <IconSwap size={15} className="shrink-0" />
        Reworded to match the records ({rewrites.length})
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {rewrites.map((r) => (
          <li key={r.key} className="grid gap-2 rounded-xl border border-line p-3.5 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid min-w-0 content-start gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">Template wording</span>
                <del className="text-muted decoration-danger/60">{show(r.before)}</del>
              </div>
              <div className="grid min-w-0 content-start gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">In this contract</span>
                <ins className="no-underline text-ink">{show(r.after)}</ins>
              </div>
            </div>
            <p className="m-0 text-xs text-muted">Why: {r.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
