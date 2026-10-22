import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHead, Status } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { dateTime, longDate } from "../../../lib/format";
import { IconPlus } from "../../../lib/icons";
import type { Me } from "../../../lib/types";
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
    <>
      <PageHead
        title="Rules"
        lede="Versioned Dubai leasing rules: notice periods, rent-cap bands, deadlines and company reference notes. Each lease keeps the version it was created under; new leases get the active one."
        actions={
          isAdmin && data?.active ? (
            <form action={createDraftAction}>
              <input type="hidden" name="basedOn" value={data.active} />
              <button type="submit" className="btn primary">
                <IconPlus size={16} />
                New draft from active
              </button>
            </form>
          ) : undefined
        }
      />
      <div className="split">
        <section className="panel">
          {versions.length === 0 ? (
            <Empty title="No rule versions">The engine stores the base version at startup.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Effective from</th>
                    <th>Published</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version}>
                      <td>
                        <Link href={`/rules/${encodeURIComponent(v.version)}`} className="row-title ref">
                          {v.version}
                        </Link>
                        {v.basedOn && <div className="row-sub">From {v.basedOn}</div>}
                      </td>
                      <td>
                        <span className="btn-row" style={{ gap: 6 }}>
                          <Status
                            value={v.status === "published" ? "approved" : "pending"}
                            label={v.status === "published" ? "Published" : "Draft"}
                          />
                          {v.isActive && <Status value="done" label="Active" />}
                        </span>
                      </td>
                      <td className="nowrap">{longDate(v.effectiveFrom)}</td>
                      <td className="muted">
                        {v.publishedAt ? (
                          <>
                            {v.publishedBy}
                            <div className="row-sub">{dateTime(v.publishedAt)}</div>
                          </>
                        ) : (
                          `Created by ${v.createdBy ?? "—"}`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="panel panel-pad">
          <h2 className="section-title">How versions work</h2>
          <div className="stack" style={{ gap: 10, fontSize: 14 }}>
            <p>
              The base version comes from the code and can&apos;t be changed. Admins copy a version into a draft, edit
              it, review the changes and publish it with an effective-from date.
            </p>
            <p>
              A published version never changes. Leases created before a new version takes effect keep their own version
              for every notice and deadline.
            </p>
            <p className="muted">
              Changes that weaken tenant protection (shorter notices, higher caps) need confirmation that a Dubai
              property lawyer reviewed them. Reference notes are guidance for staff; the engine doesn&apos;t enforce
              them.
            </p>
            {!isAdmin && <p className="muted">Only admins can edit rules.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
