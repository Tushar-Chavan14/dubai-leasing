import { PageTitle } from "@platform/ui/page";
import { Section } from "@platform/ui/record";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import Link from "next/link";
import { CaseList, parseTab } from "../../../components/compliance-cases";
import { webEnv } from "../../../lib/env";
import { InboxList } from "../../../components/inbox";
import { ExportCaseForm } from "../../../components/export-case";
import { ExportLog, ReportsSection, RetentionSection } from "../../../components/records";
import { engineGet } from "../../../lib/engine";
import { loadCases, loadExports, loadInbox, loadNoteDraft, loadReports, loadRetention } from "../../../lib/loaders";
import { requireScreen } from "../../../lib/session";
import { decideApproval } from "../decide";
import { approveRetention } from "./actions";

export const metadata: Metadata = { title: "Compliance" };

const ERRORS: Record<string, string> = {
  retention: "That list couldn't be approved. It may already be approved.",
  deal: "No deal with that reference was found.",
  export: "The pack couldn't be built. A stored document may be missing; try again or ask an admin.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; tab?: string; cursor?: string; draft?: string }>;
}) {
  const { user, item } = await requireScreen("compliance");
  const { error, tab: rawTab, cursor, draft: rawDraft } = await searchParams;
  const tab = parseTab(rawTab);
  const [inbox, cases, retention, reports, exports, draft] = await Promise.all([
    loadInbox(engineGet, undefined),
    loadCases(engineGet, tab, cursor),
    loadRetention(engineGet),
    loadReports(engineGet),
    loadExports(engineGet),
    loadNoteDraft(engineGet, rawDraft),
  ]);
  return (
    <div className="grid gap-8">
      <PageTitle
        title="Compliance"
        lede={
          item.readOnly
            ? "AML cases, enhanced due diligence and reports. You can view these settings; an admin changes them."
            : "AML cases, enhanced due diligence and reports."
        }
      />
      <p className="m-0 text-sm">
        <Link href="/compliance/policy" className="font-semibold text-ink underline underline-offset-2">
          Compliance rules
        </Link>
        <span className="text-muted"> — the warning signs, cut-offs and re-check points, and their versions.</span>
      </p>
      {error && ERRORS[error] && (
        <p role="alert" className={ALERT.bad}>
          {ERRORS[error]}
        </p>
      )}
      <Section id="inbox" title="Waiting for your decision" hint="Reviews and reports your role decides, oldest first">
        <InboxList
          items={inbox?.items ?? []}
          viewer={user.role}
          decideAction={decideApproval}
          demo={webEnv().SPA_DEMO_MODE}
          from="compliance"
          draft={draft}
          error={error && !ERRORS[error] ? error : undefined}
          next={null}
        />
      </Section>
      <Section id="cases" title="Cases" hint="Open a case to read the screening, the evidence and the trail">
        <CaseList tab={tab} items={cases?.items ?? []} next={cases?.nextCursor ?? null} />
      </Section>
      <Section id="export-case" title="Case export" hint="One deal as a ZIP. Each export is logged.">
        <ExportCaseForm />
      </Section>
      <RetentionSection reviews={retention?.items ?? []} approveAction={approveRetention} />
      <ReportsSection reports={reports?.items ?? []} />
      <ExportLog items={exports?.items ?? []} />
    </div>
  );
}
