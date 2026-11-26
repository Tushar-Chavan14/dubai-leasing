import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { TabLinks } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { ROW_CARD, Section, Sub } from "@platform/ui/record";
import type { SpaRole } from "@spa/core";
import Link from "next/link";
import {
  CASE_TABS,
  type CaseRow,
  type CaseSubject,
  type CaseTab,
  type CaseView,
  type Suggestion,
} from "../lib/contracts";
import { dubaiDateTime, shortDate } from "../lib/format";
import { InboxList } from "./inbox";

/**
 * The Compliance screen's cases (C33, S65, design §4.8): read only except the decision card. Everything is drawn from
 * what the engine sent a compliance role (masked). The model's wording is a labelled suggestion and is written as plain
 * text (React escapes it): it is never shown as a finding, and what code found is listed apart from it.
 */

export const TAB_LABELS: Record<CaseTab, string> = {
  open: "Open cases",
  info_requested: "More info asked",
  edd: "EDD",
  reported: "Reported",
  closed: "Closed",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  info_requested: "More information asked",
  edd: "Sign-off needed",
  reported: "Reported",
  cleared: "Cleared",
  stopped: "Stopped",
};
const RULE_LABELS: Record<string, string> = {
  sanctions: "Sanctions list",
  pep: "PEP list",
  third_party_payer: "Third-party payer",
  cash: "Cash",
  high_risk_country: "High-risk country",
  missing_source_of_funds: "No source of funds",
  complex_ownership: "Complex ownership",
  not_screened: "Not screened",
  unconfirmed: "Threshold not confirmed",
};
const ruleLabel = (r: string) => RULE_LABELS[r] ?? "Other rule";
const LEVEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

export const casesHref = (tab: CaseTab, cursor?: string) =>
  `/compliance?tab=${tab}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}#cases`;
export const parseTab = (v: unknown): CaseTab =>
  (CASE_TABS as readonly string[]).includes(v as string) ? (v as CaseTab) : "open";

function SuggestionBlock({ s }: { s: Suggestion }) {
  return (
    <div className="grid gap-1 border-l-2 border-line pl-3">
      <b className="text-sm font-semibold">
        {s.label}
        {s.fromModel ? " · written by a model" : " · standard wording"}
      </b>
      <p className="m-0 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{s.text}</p>
      {s.instructionLike && <Sub>A name here reads like an instruction. It was not followed.</Sub>}
      <Sub>Not a finding. What code found is listed below.</Sub>
    </div>
  );
}

export function CaseList({ tab, items, next }: { tab: CaseTab; items: CaseRow[]; next: string | null }) {
  return (
    <div className="grid gap-3">
      <TabLinks
        label="Cases"
        items={CASE_TABS.map((t) => ({ href: casesHref(t), label: TAB_LABELS[t], current: t === tab }))}
      />
      {items.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {items.map((c) => (
            <li key={c.id} className={`${ROW_CARD} m-0 grid gap-1.5`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={`/compliance/cases/${c.id}`}
                  className="font-mono text-sm font-semibold text-ink underline underline-offset-2"
                >
                  {c.dealRef}
                </Link>
                <Pill tone={c.status === "open" || c.status === "edd" ? "waiting" : "neutral"}>
                  {STATUS_LABELS[c.status] ?? "Closed"}
                </Pill>
                <Sub>
                  {c.kind === "edd" ? `Enhanced due diligence${c.partyName ? ` · ${c.partyName}` : ""}` : "Case"} ·
                  opened {shortDate(c.openedAt)}
                  {c.closedAt ? ` · closed ${shortDate(c.closedAt)}` : ""}
                </Sub>
              </div>
              {c.rules.length > 0 && <Sub>{c.rules.map(ruleLabel).join(" · ")}</Sub>}
              {c.suggestion && (
                <p className="m-0 text-[13px] text-muted [overflow-wrap:anywhere]">
                  <i className="not-italic font-semibold">{c.suggestion.label}</i> · {c.suggestion.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={`Nothing under ${TAB_LABELS[tab]}.`} body="Cases appear here as the engine opens them." />
      )}
      {next && (
        <Link href={casesHref(tab, next)} className={buttonClass("ghost", "sm")}>
          Next page
        </Link>
      )}
    </div>
  );
}

const fieldText = (v: unknown): string => {
  if (v && typeof v === "object" && "value" in v) return fieldText((v as { value: unknown }).value);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};
const fieldLabel = (k: string) => {
  const w = k
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

function Subject({ s }: { s: CaseSubject }) {
  const sc = s.screening;
  return (
    <li className={`${ROW_CARD} m-0 grid gap-2`}>
      <b className="font-semibold [overflow-wrap:anywhere]">{s.label}</b>
      {sc ? (
        <div className="grid gap-1">
          <Sub>
            Screened {shortDate(sc.date)} · list {sc.listVersion} ({sc.listLabel.toLowerCase()})
            {sc.exact ? " · exact match" : ""}
          </Sub>
          {sc.notScreened && <Sub>Not screened against every list.</Sub>}
          <table className="w-full max-w-xl border-collapse text-sm">
            <caption className="sr-only">Screening scores against the threshold</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-1 pr-3 font-medium">
                  List
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Score
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Threshold
                </th>
                <th scope="col" className="py-1 font-medium">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {sc.checks.map((c) => (
                <tr key={c.rule}>
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {ruleLabel(c.rule)}
                  </th>
                  <td className="py-1 pr-3 tabular-nums">{c.score === null ? "Not screened" : c.score.toFixed(2)}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    {c.threshold === null ? "None" : c.threshold.toFixed(2)}
                    {c.thresholdPending ? " (awaits legal)" : ""}
                  </td>
                  <td className="py-1">{c.score === null ? "No result" : c.over ? "At or over" : "Under"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sc.entries.length > 0 && (
            <Sub>
              Entries found:{" "}
              {sc.entries.map((e) => `${ruleLabel(e.list)} ${e.entryId} (${e.score.toFixed(2)})`).join(" · ")}
            </Sub>
          )}
        </div>
      ) : (
        <Sub>No screening on record for this person.</Sub>
      )}
      {s.hits.length > 0 && (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {s.hits.map((h) => (
            <li key={`${h.rule}-${h.detail}`} className="m-0 text-sm [overflow-wrap:anywhere]">
              <b className="font-semibold">{ruleLabel(h.rule)}</b>
              {h.severity === "flag" ? " (flags the case)" : " (warning)"}: {h.detail}
            </li>
          ))}
        </ul>
      )}
      {s.risk && (
        <div className="grid gap-0.5 text-sm">
          <span>
            <b className="font-semibold">Risk: {LEVEL[s.risk.level]}</b> · {s.risk.points} points · policy v
            {s.risk.policyVersion} · assessed {shortDate(s.risk.date)}
          </span>
          {s.risk.breakdown.length > 0 && (
            <ul className="m-0 grid list-none gap-0 p-0 text-[12.5px] text-muted">
              {s.risk.breakdown.map((b) => (
                <li key={b.source} className="m-0">
                  {b.source}: {b.points}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** One case: screening per person, evidence, risk, the suggestion, the decision card and the trail. */
export function CaseDetail({
  view,
  viewer,
  decideAction,
}: {
  view: CaseView;
  viewer: SpaRole;
  decideAction: (formData: FormData) => void | Promise<void>;
}) {
  const c = view.case;
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill tone={c.status === "open" || c.status === "edd" ? "waiting" : "neutral"}>
          {STATUS_LABELS[c.status] ?? "Closed"}
        </Pill>
        <Sub>
          {c.kind === "edd" ? "Enhanced due diligence" : "Case"} · opened {shortDate(c.openedAt)}
          {c.closedAt ? ` · closed ${shortDate(c.closedAt)}` : ""} · lists are {view.label.toLowerCase()}
        </Sub>
        <Link href={`/compliance/deals/${view.dealId}`} className="text-[13px] text-ink! underline underline-offset-2">
          Deal record
        </Link>
      </div>
      {view.suggestion && (
        <Section id="suggestion" title="Summary" hint="Wording only. A person decides.">
          <SuggestionBlock s={view.suggestion} />
        </Section>
      )}
      <Section id="screening" title="Screening and risk" hint="What code found, person by person">
        {view.subjects.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {view.subjects.map((s) => (
              <Subject key={s.subjectKey} s={s} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No one on this deal yet." body="Screening is listed once people are on the deal." />
        )}
      </Section>
      <Section id="funds" title="Source of funds" hint="What the document reader copied. Read, not confirmed.">
        {view.sourceOfFunds.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {view.sourceOfFunds.map((r) => (
              <li key={r.id} className={`${ROW_CARD} m-0 grid gap-1`}>
                <b className="text-sm font-semibold [overflow-wrap:anywhere]">
                  {r.fileName}
                  {r.partyName ? ` · ${r.partyName}` : ""}
                </b>
                <Sub>Read {shortDate(r.readAt)}</Sub>
                <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-sm">
                  {Object.entries(r.fields).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{fieldLabel(k)}</dt>
                      <dd className="m-0 [overflow-wrap:anywhere]">{fieldText(v)}</dd>
                    </div>
                  ))}
                </dl>
                {r.instructionFound && (
                  <Sub>The document holds text that reads like an instruction. It was not followed.</Sub>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No source-of-funds evidence on file." body="Ask for it with the decision below." />
        )}
      </Section>
      <Section id="inbox" title="Decision" hint="The same card as the inbox">
        {view.approval ? (
          <InboxList
            items={[view.approval]}
            viewer={viewer}
            decideAction={decideAction}
            from="compliance"
            backTo={`/compliance/cases/${c.id}`}
          />
        ) : (
          <Sub>This case has no decision waiting.</Sub>
        )}
      </Section>
      <Section id="trail" title="Case trail" hint="Compliance events on this deal, oldest first">
        {view.trail.length ? (
          <ol className="m-0 grid list-none gap-3 p-0">
            {view.trail.map((e) => (
              <li key={e.id} className="m-0 grid gap-0.5 border-l-2 border-line pl-3 text-sm">
                <time dateTime={e.at} className="text-xs text-muted tabular-nums">
                  {dubaiDateTime(e.at)}
                </time>
                <span>{e.label}</span>
                <span className="text-[12.5px] text-muted">{e.actor.label}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Sub>No events yet.</Sub>
        )}
      </Section>
    </div>
  );
}
