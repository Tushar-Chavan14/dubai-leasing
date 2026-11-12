import { EMIRATE_LABELS } from "@leasing/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AskAiMenu } from "../../../../../components/ask-ai";
import { Status } from "../../../../../components/ui";
import { Banner } from "../../../../../components/ui/form";
import { FactList } from "../../../../../components/ui/record";
import { FormGrid, Panel, SetPage, TABLE, TD, TH } from "../../../../../components/ui/settings";
import { askPrompts } from "../../../../../lib/ask-ai/prompts";
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
    <SetPage
      back={{ href: "/settings/rulebook", label: "Rulebook" }}
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-mono">{r.version}</span>
          <span className="flex flex-wrap gap-1.5 font-sans text-base">
            <Status
              value={r.status === "published" ? "approved" : "pending"}
              label={r.status === "published" ? "Published" : "Draft"}
            />
            {r.isActive && <Status value="done" label="Active" />}
          </span>
        </span>
      }
      lede={
        r.status === "published"
          ? `${EMIRATE_LABELS[r.emirate]}. Effective from ${longDate(r.effectiveFrom)}. Published by ${r.publishedBy ?? "—"}${r.publishedAt ? ` on ${dateTime(r.publishedAt)}` : ""}. A published version can't be changed.`
          : `${EMIRATE_LABELS[r.emirate]} draft based on ${r.basedOn ?? "—"}, created by ${r.createdBy ?? "—"}. Nothing uses it until it is published.`
      }
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage(`Rulebook ${r.version}`)} />}
    >
      {editable ? (
        <RuleEditor detail={r} />
      ) : (
        <FormGrid
          preview={
            <aside className="grid gap-5 self-start">
              <Sources sources={r.values.sources} />
              {r.changesVsActive.length > 0 && (
                <ChangesList title={`Changes vs active (${r.active})`} changes={r.changesVsActive} />
              )}
              {r.loosened.length > 0 && (
                <Banner tone="warn">
                  <span>
                    {r.baseVersion
                      ? `Weaker tenant protection than the base version ${r.baseVersion}: `
                      : "No reviewed rules for this emirate before this version: "}
                    {r.loosened
                      .map((l) =>
                        l.base === null && l.value === null
                          ? l.field
                          : `${fieldLabel(l.field)} ${show(l.base)} → ${show(l.value)}`,
                      )
                      .join("; ")}
                    .
                  </span>
                </Banner>
              )}
              <History events={r.events} />
            </aside>
          }
        >
          <Panel className="grid gap-3 p-5">
            <h2 id="values-h" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
              Notices and deadlines
            </h2>
            <FactList>
              {NUMBER_FIELDS.filter((f) => f.path !== "aboveLastBandMaxIncrease").map((f) => (
                <FactRow key={f.path} label={f.label} hint={f.hint}>
                  {readPath(r.values, f.path)} {f.unit}
                </FactRow>
              ))}
            </FactList>
          </Panel>
          <Panel className="overflow-x-auto">
            <div className="flex flex-wrap items-baseline gap-x-3 px-5 pt-5">
              <h2 id="bands-h" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
                Rent-cap bands
              </h2>
              <span className="text-xs text-muted">gap = how far current rent is below the SRI average</span>
            </div>
            <table className={`${TABLE} mt-3`}>
              <thead>
                <tr>
                  <th className={TH}>Gap below SRI average</th>
                  <th className={`${TH} text-right`}>Max increase</th>
                </tr>
              </thead>
              <tbody>
                {bandRows(r.values).map((b) => (
                  <tr key={b.gap} className="group">
                    <td className={TD}>{b.gap}</td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>{b.max}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <ReferenceNotes notes={r.referenceRules} />
        </FormGrid>
      )}
    </SetPage>
  );
}
