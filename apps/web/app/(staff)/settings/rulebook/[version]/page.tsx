import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHead, Status } from "../../../../../components/ui";
import { get } from "../../../../../lib/engine";
import { dateTime, longDate } from "../../../../../lib/format";
import type { Me } from "../../../../../lib/types";
import { bandRows, fieldLabel, NUMBER_FIELDS, readPath, type RulebookDetail, show } from "../labels";
import { ChangesList, FactRow, History, ReferenceNotes, Sources } from "../parts";
import { RuleEditor } from "./rule-editor";

export async function generateMetadata({ params }: { params: Promise<{ version: string }> }): Promise<Metadata> {
  return { title: `Rules ${decodeURIComponent((await params).version)}` };
}

export default async function RulebookPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const [r, me] = await Promise.all([
    get<RulebookDetail>(`/api/rulebooks/${encodeURIComponent(decodeURIComponent(version))}`),
    get<Me>("/api/me"),
  ]);
  if (!r) notFound();
  const editable = me?.role === "admin" && r.status === "draft";
  return (
    <>
      <PageHead
        back={{ href: "/settings/rulebook", label: "Rulebook" }}
        title={<span className="ref">{r.version}</span>}
        badge={
          <span className="btn-row" style={{ gap: 6 }}>
            <Status
              value={r.status === "published" ? "approved" : "pending"}
              label={r.status === "published" ? "Published" : "Draft"}
            />
            {r.isActive && <Status value="done" label="Active" />}
          </span>
        }
        lede={
          r.status === "published"
            ? `Effective from ${longDate(r.effectiveFrom)}. Published by ${r.publishedBy ?? "—"}${r.publishedAt ? ` on ${dateTime(r.publishedAt)}` : ""}. A published version can't be changed.`
            : `Draft based on ${r.basedOn ?? "—"}, created by ${r.createdBy ?? "—"}. Nothing uses it until it is published.`
        }
      />

      {editable ? (
        <RuleEditor detail={r} />
      ) : (
        <div className="split">
          <div className="stack">
            <section className="panel panel-pad" aria-labelledby="values-h">
              <h2 id="values-h" className="section-title">
                Notices and deadlines
              </h2>
              <dl className="facts">
                {NUMBER_FIELDS.filter((f) => f.path !== "aboveLastBandMaxIncrease").map((f) => (
                  <FactRow key={f.path} label={f.label} hint={f.hint}>
                    {readPath(r.values, f.path)} {f.unit}
                  </FactRow>
                ))}
              </dl>
            </section>
            <section className="panel" aria-labelledby="bands-h">
              <div className="panel-head">
                <h2 id="bands-h">Rent-cap bands</h2>
                <span className="hint">gap = how far current rent is below the SRI average</span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Gap below SRI average</th>
                      <th className="num">Max increase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bandRows(r.values).map((b) => (
                      <tr key={b.gap}>
                        <td>{b.gap}</td>
                        <td className="num">{b.max}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <ReferenceNotes notes={r.referenceRules} />
          </div>
          <aside className="stack">
            <Sources sources={r.values.sources} />
            {r.changesVsActive.length > 0 && (
              <ChangesList title={`Changes vs active (${r.active})`} changes={r.changesVsActive} />
            )}
            {r.loosened.length > 0 && (
              <div className="alert" data-tone="warn">
                <span>
                  Weaker tenant protection than the base version {r.baseVersion}:{" "}
                  {r.loosened.map((l) => `${fieldLabel(l.field)} ${show(l.base)} → ${show(l.value)}`).join("; ")}.
                </span>
              </div>
            )}
            <History events={r.events} />
          </aside>
        </div>
      )}
    </>
  );
}
