import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon as IconPlus } from "@phosphor-icons/react/dist/ssr";
import { AskAiMenu } from "../../../../components/ask-ai";
import { Status } from "../../../../components/ui";
import { Button } from "../../../../components/ui/button";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Sub } from "../../../../components/ui/record";
import { FormGrid, Panel, Preview, SetPage, TABLE, TD, TH } from "../../../../components/ui/settings";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { get } from "../../../../lib/engine";
import { dateTime, longDate } from "../../../../lib/format";
import type { Me } from "../../../../lib/types";
import { createDraftAction } from "./actions";
import type { RulebookSummary } from "./labels";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage() {
  const [data, me] = await Promise.all([
    get<{ today: string; active: string | null; versions: RulebookSummary[] }>("/api/rulebooks"),
    get<Me>("/api/me"),
  ]);
  const isAdmin = me?.role === "admin";
  const versions = (data?.versions ?? []).toReversed();
  return (
    <SetPage
      title="Rulebook"
      lede="Versioned Dubai leasing rules: notice periods, rent-cap bands, deadlines and company reference notes. Each lease keeps the version it was created under; new leases get the active one."
      actions={
        <>
          <AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Rulebook")} />
          {isAdmin && data?.active ? (
            <form action={createDraftAction}>
              <input type="hidden" name="basedOn" value={data.active} />
              <Button type="submit" variant="primary" size="sm">
                <IconPlus size={16} />
                New draft from active
              </Button>
            </form>
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
                Changes that weaken tenant protection (shorter notices, higher caps) need confirmation that a Dubai
                property lawyer reviewed them. Reference notes are guidance for staff; the engine doesn&apos;t enforce
                them.
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
