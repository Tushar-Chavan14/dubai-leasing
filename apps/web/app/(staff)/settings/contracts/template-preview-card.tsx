import { buttonClass } from "../../../../components/ui/button";
import { Pill } from "../../../../components/ui/pill";
import { Preview } from "../../../../components/ui/settings";
import type { Emirate } from "@leasing/core";
import type { CompanyRow, CompanyTemplatePanel } from "../../../../lib/types";

/** Right-hand summary: which contract the company's contracts follow, with a link to preview it. */
export function TemplatePreviewCard({
  company,
  panel,
  tab,
}: {
  company: CompanyRow;
  panel: CompanyTemplatePanel | null;
  /** The emirate tab: the newest approved template usable there (one naming it before an any-emirate one). */
  tab: Emirate | "any";
}) {
  const approved = panel?.templates.filter((t) => t.status === "approved") ?? [];
  const inUse =
    (tab === "any" ? undefined : approved.find((t) => t.emirates.includes(tab))) ??
    approved.find((t) => t.emirates.length === 0);
  const proposed = panel?.review?.templateId
    ? panel.templates.find((t) => t.id === panel.review?.templateId)
    : undefined;
  const shown = inUse ?? proposed;
  const fields = shown ? shown.blanks.filter((b) => b.role === "field").length : 0;
  return (
    <Preview
      title="Contract preview"
      lede={`What ${company.name}'s contracts look like. Clauses and rules on the left feed it.`}
    >
      {shown ? (
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm font-semibold">
              {shown.name} · v{shown.version}
            </b>
            <Pill tone={shown.status === "approved" ? "accent" : "waiting"}>
              {shown.status === "approved" ? "In use" : "Waiting for review"}
            </Pill>
          </div>
          <p className="m-0 text-[13px] text-muted">
            {shown.sections.items.length} sections, {fields} {fields === 1 ? "field" : "fields"} filled from the
            records.
          </p>
          <a
            href={`/api/contract-templates/${shown.id}/preview`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("ghost", "sm")}
          >
            Preview contract
          </a>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">
          {company.name} uses the standard contract layout. Upload a sample contract under Contract templates and the
          agent reads it into a company template you can preview here.
        </p>
      )}
      <a href={`/settings/contract-templates?company=${company.id}`} className={buttonClass("ghost", "sm")}>
        Manage contract templates
      </a>
    </Preview>
  );
}
