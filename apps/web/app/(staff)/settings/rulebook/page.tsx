import type { Metadata } from "next";
import Link from "next/link";
import { type Emirate, EMIRATE_LABELS } from "@leasing/core";
import { AskAiMenu } from "../../../../components/ask-ai";
import { Status } from "../../../../components/ui";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Sub } from "../../../../components/ui/record";
import { FormGrid, Panel, Preview, SetPage, TABLE, TD, TH } from "../../../../components/ui/settings";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { get } from "../../../../lib/engine";
import { dateTime, longDate } from "../../../../lib/format";
import type { Me } from "../../../../lib/types";
import type { RulebookSummary } from "./labels";
import { NewDraft } from "./new-draft";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage() {
  const [data, me] = await Promise.all([
    get<{
      today: string;
      active: string | null;
      activeByEmirate: Record<Emirate, string | null>;
      versions: RulebookSummary[];
    }>("/api/rulebooks"),
    get<Me>("/api/me"),
  ]);
  const isAdmin = me?.role === "admin";
  const versions = (data?.versions ?? []).toReversed();
  return (
    <SetPage
      title="Rulebook"
      lede="Versioned leasing rules per emirate: notice periods, rent-cap bands, deadlines and company reference notes. Each lease keeps the version it was created under; new leases get the active version of their emirate. An emirate with no version takes no offers or leases."
      actions={
        <>
          <AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Rulebook")} />
          {isAdmin && data ? (
            <NewDraft
              activeByEmirate={data.activeByEmirate}
              published={versions
                .filter((v) => v.status === "published")
                .map((v) => ({ version: v.version, emirate: v.emirate }))}
            />
          ) : undefined}
        </>
      }
    >
      <FormGrid
        preview={
          <Preview title="How versions work">
            <div className="grid gap-2.5 text-[13px] leading-snug text-ink">
              <p className="m-0">
                The base version comes from the code and can&apos;t be changed. Admins copy a version into a draft, edit
                it, review the changes and publish it with an effective-from date.
              </p>
              <p className="m-0">
                A published version never changes. Leases created before a new version takes effect keep their own
                version for every notice and deadline.
              </p>
              <p className="m-0 text-muted">
                Changes that weaken tenant protection (shorter notices, higher caps) need confirmation that a property
                lawyer in that emirate reviewed them. So does the first version of an emirate with no rules yet.
                Reference notes are guidance for staff; the engine doesn&apos;t enforce them.
              </p>
              {!isAdmin && <p className="m-0 text-muted">Only admins can edit rules.</p>}
            </div>
          </Preview>
        }
      >
        {versions.length === 0 ? (
          <EmptyState title="No rule versions" body="The engine stores the base version at startup." />
        ) : (
          <Panel className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Version</th>
                  <th className={TH}>Emirate</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Effective from</th>
                  <th className={TH}>Published</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version} className="group">
                    <td className={TD}>
                      <Link
                        href={`/settings/rulebook/${encodeURIComponent(v.version)}`}
                        className="font-mono text-[13px] font-semibold text-ink! no-underline hover:underline"
                      >
                        {v.version}
                      </Link>
                      {v.basedOn && <Sub>From {v.basedOn}</Sub>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{EMIRATE_LABELS[v.emirate]}</td>
                    <td className={TD}>
                      <span className="flex flex-wrap gap-1.5">
                        <Status
                          value={v.status === "published" ? "approved" : "pending"}
                          label={v.status === "published" ? "Published" : "Draft"}
                        />
                        {v.isActive && <Status value="done" label="Active" />}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{longDate(v.effectiveFrom)}</td>
                    <td className={`${TD} text-muted`}>
                      {v.publishedAt ? (
                        <>
                          {v.publishedBy}
                          <Sub>{dateTime(v.publishedAt)}</Sub>
                        </>
                      ) : (
                        `Created by ${v.createdBy ?? "—"}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </FormGrid>
    </SetPage>
  );
}
