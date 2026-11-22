import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { Pill } from "@platform/ui/pill";
import { ROW_CARD, Section, Sub } from "@platform/ui/record";
import type { ExportItem, ReportItem, RetentionReview } from "../lib/contracts";
import { monthLabel, shortDate, sizeLabel } from "../lib/format";

/**
 * The monthly retention lists (C23, S29, S62): the deals past the retention years, who approved the list and when. The
 * approval only records that the list was reviewed; nothing is deleted, and the screen says so.
 */
export function RetentionSection({
  reviews,
  approveAction,
}: {
  reviews: RetentionReview[];
  approveAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <Section
      id="retention"
      title="Retention lists"
      hint="Deals that ended at least the retention years ago. Nothing is deleted."
    >
      {!reviews.length ? (
        <EmptyState
          title="No lists yet."
          body="A list is made on the 1st of a month when a deal is past its retention."
        />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {reviews.map((r) => (
            <li key={r.id} className={`${ROW_CARD} m-0 grid gap-2`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <b className="block font-semibold">{monthLabel(r.period)}</b>
                  <Sub>
                    {r.items.length} {r.items.length === 1 ? "deal" : "deals"} · ended on or before{" "}
                    {shortDate(r.cutoffOn)} · {r.retentionYears} years (confirm with compliance)
                  </Sub>
                </div>
                {r.status === "approved" ? (
                  <Pill tone="accent">
                    Approved by {r.approvedByName ?? "a compliance role"}
                    {r.approvedAt ? ` on ${shortDate(r.approvedAt)}` : ""}
                  </Pill>
                ) : (
                  <form action={approveAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={buttonClass("primary", "sm")}>
                      Approve list
                      <span className="sr-only">: {monthLabel(r.period)}</span>
                    </button>
                  </form>
                )}
              </div>
              {r.items.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-muted">
                  {r.items.map((i) => (
                    <li key={i.ref} className="m-0 p-0">
                      {i.ref} · ended {shortDate(i.endedOn)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="m-0 text-xs text-muted">
                Nothing is deleted by listing or by approving. Deleting waits until compliance defines it.
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The monthly compliance reports (C23, S62): one row per month with the CSV and the PDF. */
export function ReportsSection({ reports }: { reports: ReportItem[] }) {
  return (
    <Section id="reports" title="Monthly reports" hint="Made on the 1st for the month before. Each download is logged.">
      {!reports.length ? (
        <EmptyState title="No reports yet." body="The first report is made on the 1st of next month." />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {reports.map((r) => (
            <li key={r.id} className={`${ROW_CARD} m-0 flex flex-wrap items-center gap-x-4 gap-y-2`}>
              <div className="min-w-0 flex-1">
                <b className="block font-semibold">{monthLabel(r.period)}</b>
                <Sub>Made {shortDate(r.generatedAt)}</Sub>
              </div>
              <a href={`/compliance/reports/${r.id}.csv`} className={buttonClass("ghost", "sm")}>
                CSV<span className="sr-only"> for {monthLabel(r.period)}</span>
              </a>
              <a href={`/compliance/reports/${r.id}.pdf`} className={buttonClass("ghost", "sm")}>
                PDF<span className="sr-only"> for {monthLabel(r.period)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const KIND_LABEL: Record<ExportItem["kind"], string> = { case_pack: "Case pack", monthly_report: "Monthly report" };

/** Every export, who made it and when (C23, S62). */
export function ExportLog({ items }: { items: ExportItem[] }) {
  return (
    <Section id="exports" title="Export log" hint="Who exported what, and when.">
      {!items.length ? (
        <EmptyState title="No exports yet." body="Exports of a case pack or a report will be listed here." />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((e) => (
            <li key={e.id} className={`${ROW_CARD} m-0 flex flex-wrap items-center gap-x-4 gap-y-1`}>
              <div className="min-w-0 flex-1">
                <b className="block font-semibold">
                  {KIND_LABEL[e.kind]}
                  {e.dealRef ? ` · ${e.dealRef}` : ""}
                </b>
                <Sub>
                  {e.requestedByName} · {shortDate(e.requestedAt)} · {sizeLabel(e.sizeBytes)} · {e.fileCount}{" "}
                  {e.fileCount === 1 ? "file" : "files"}
                </Sub>
              </div>
              <code className="text-xs text-muted" title="SHA-256">
                {e.sha256.slice(0, 12)}
              </code>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
