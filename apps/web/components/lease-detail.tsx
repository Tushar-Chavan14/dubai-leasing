import type { ReactNode } from "react";
import type { StaffRole } from "@leasing/core";
import { canSeeUnits } from "../lib/shell/nav";
import { TENANCY_OPS } from "../lib/env";
import { CasePanel } from "./case-panel";
import { MoveOutPanel, type MoveOutView } from "./move-out-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ManualRegistration } from "./manual-registration";
import { type ClauseOptions, ContractPanel, type ContractRow, type EjariAttempt, EjariPanel } from "./contract-panel";
import { type InboundRow, type OutboundRow, RenewalPanel } from "./renewal-panel";
import { RenewalTimeline } from "./renewal-timeline";
import {
  type ComplaintRow,
  ComplaintsPanel,
  MoveInPanel,
  type MoveInView,
  type PaymentRow,
  PaymentsPanel,
} from "./tenancy-panels";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { Due, Status } from "./ui";
import { AskAi } from "./ask-ai";
import { askPrompts } from "../lib/ask-ai/prompts";
import { Fact, FactGrid, FactKey, FactList, FactVal, ROW_CARD, Section, Sub } from "./ui/record";
import { AddTaskForm, EmailTenantForm, TaskActions, VacateNoticeForm } from "./work-forms";
import { engine, get, publicGet } from "../lib/engine";
import {
  actorLabel,
  aedShort,
  bedroomsLabel,
  dateTime,
  eventLabel,
  longDate,
  milestoneLabel,
  roleLabel,
  shortDate,
} from "../lib/format";
import type { Me, UnitDetail } from "../lib/types";

interface LeaseView {
  id: string;
  ref: string;
  state: string;
  startOn: string;
  endOn: string;
  annualRentFils: number;
  cheques: number;
  depositFils: number;
  rulesVersion: string;
  ejariNo: string | null;
  unitId: string;
  unit: { id: string; code: string; building: string; community: string; state: string; bedrooms: number | null };
  parties: {
    role: string;
    fullNameEn: string;
    email: string | null;
    phone: string | null;
    emiratesIdNo: string | null;
  }[];
  deadlines: { id: string; milestone: string; dueOn: string; status: string; note: string | null }[];
  approvals: {
    id: string;
    title: string;
    status: string;
    gate: string;
    createdAt: string;
    proposal: Record<string, unknown>;
    editedProposal: Record<string, unknown> | null;
  }[];
  outbound: OutboundRow[];
  inbound: InboundRow[];
  tasks: { id: string; kind: string; title: string; status: string; dueOn: string | null; assigneeRole: string }[];
  events: {
    id: string;
    type: string;
    actor: string;
    at: string;
    toState: string | null;
    payload: Record<string, unknown>;
  }[];
  contracts: ContractRow[];
  clauseOptions?: ClauseOptions;
  prepareNeeded?: "failed" | "rejected" | "not_prepared" | "rules_changed" | null;
  ejari: EjariAttempt[];
  /** The registration system of the unit's emirate (Ejari in Dubai). */
  registration?: { emirate: string; systemName: string };
}

interface DraftRow {
  id: string;
  kind: string;
  leaseId: string | null;
  subject: string | null;
  body: string;
  status: string;
}

const OFF_COPY = "Tenancy operations are switched off.";
function TenancyOff() {
  return <p className="m-0 text-sm text-muted">{OFF_COPY}</p>;
}

/** The lease, in full: renewal path, contract, Ejari, move-in and move-out, payments, cases. Rendered in the Workspace detail pane. */
export async function LeaseDetail({ id, draftId }: { id: string; draftId?: string | undefined }) {
  const l = await get<LeaseView>(`/api/leases/${id}`);
  if (!l) notFound();
  const [health, unit, me, payments, complaints] = await Promise.all([
    publicGet<{ today: string; demoMode: boolean }>("/health"),
    get<UnitDetail>(`/api/units/${l.unit.id}`),
    get<Me>("/api/me"),
    get<PaymentRow[]>(`/api/leases/${id}/payments`),
    get<ComplaintRow[]>(`/api/leases/${id}/complaints`),
  ]);
  // The move-in checklist: while moving in, and afterwards as the condition record.
  const moveIn = ["MOVE_IN", "ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE"].includes(l.state)
    ? await get<MoveInView>(`/api/leases/${id}/move-in`)
    : null;
  // Step 10: the move-out inspection and deposit (kept afterwards as the record).
  const moveOut = ["MOVE_OUT", "DISPUTE", "CLOSED"].includes(l.state)
    ? await get<MoveOutView>(`/api/leases/${id}/move-out`)
    : null;
  const canAct = me?.role === "leasing_officer" || me?.role === "leasing_manager";
  // Manual registration (D52): the portal details and pack, for leasing roles once the lease reaches registration.
  const manual =
    canAct && (l.state === "REGISTRATION" || (l.ejari ?? []).length > 0)
      ? await engine<ManualRegistration>(`/api/leases/${id}/registration`).then((r) => (r.ok ? r.data : null))
      : null;
  const canEmail = canAct || me?.role === "finance";
  // Finance cannot open Units, so the unit card is not a link for them.
  const unitCard = (body: ReactNode) =>
    !me || canSeeUnits(me.role as StaffRole) ? (
      <Link
        href={`/units/${l.unit.id}`}
        className={`${ROW_CARD} flex items-center gap-3 p-2 hover:border-ink`}
        aria-label={`Unit ${l.unit.code}`}
      >
        {body}
      </Link>
    ) : (
      <div className={`${ROW_CARD} flex items-center gap-3 p-2`}>{body}</div>
    );
  // A copilot draft (the user's own) prefills the email form; a used one doesn't.
  const draftRow =
    draftId && canEmail ? await get<DraftRow>(`/api/copilot/drafts/${encodeURIComponent(draftId)}`) : null;
  const draft =
    draftRow && draftRow.kind === "email" && draftRow.leaseId === l.id && draftRow.status === "draft" ? draftRow : null;
  const caseDraft =
    draftRow && draftRow.kind === "case_summary" && draftRow.leaseId === l.id && draftRow.status === "draft"
      ? draftRow
      : null;
  const running = l.state === "ACTIVE" || l.state === "RENEWAL";
  const today = health?.today ?? "";
  const tenant = l.parties.find((p) => p.role === "tenant");
  const landlord = l.parties.find((p) => p.role === "landlord");
  const next = l.deadlines.find((d) => d.status === "pending");
  const cover = unit?.photos[0];
  const openTasks = l.tasks.filter((t) => t.status === "open");
  const ejariApproval = l.approvals.find(
    (a) => (a.gate === "ejari_submission" || a.gate === "ejari_rejected_twice") && a.status === "pending",
  );
  const demo = !!health?.demoMode;

  const contractAsk = askPrompts.contractEjari(l.ref)[0]!;
  const LIST = "m-0 grid list-none gap-1.5 p-0";
  return (
    <div className="grid gap-8">
      <p className="m-0 text-sm text-muted">
        <Status value={l.state} /> Lease <span className="font-mono text-xs">{l.ref}</span>, {shortDate(l.startOn)} to{" "}
        {longDate(l.endOn)}. Rules <span className="font-mono text-xs">{l.rulesVersion}</span>.
      </p>

      <Section id="terms-h" title="Terms">
        <FactGrid>
          <Fact label="Annual rent">{aedShort(l.annualRentFils)}</Fact>
          <Fact label="Cheques">{l.cheques}</Fact>
          <Fact label="Deposit">{aedShort(l.depositFils)}</Fact>
          <Fact label={l.registration?.systemName ?? "Ejari"} mono={!!l.ejariNo}>
            {l.ejariNo ?? "Not registered"}
          </Fact>
        </FactGrid>
        {unitCard(
          <>
            <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-raised">
              {cover ? (
                <img
                  src={`/media/units/${l.unit.id}/${cover.id}`}
                  alt={cover.caption ?? `Unit ${l.unit.code}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <span className="grid size-full place-items-center text-muted" title="No photos yet">
                  <BuildingsIcon size={22} aria-hidden />
                </span>
              )}
            </div>
            <div className="grid min-w-0 gap-0.5 text-sm">
              <span>
                <b className="font-semibold">{l.unit.code}</b>{" "}
                <span className="text-muted">{bedroomsLabel(l.unit.bedrooms)}</span>
              </span>
              <Sub>
                {l.unit.building}, {l.unit.community}
              </Sub>
            </div>
          </>,
        )}
      </Section>

      <Section id="people-h" title="People">
        <FactList>
          {tenant && (
            <>
              <FactKey>Tenant</FactKey>
              <FactVal>
                {tenant.fullNameEn}
                <Sub>{[tenant.email, tenant.phone].filter(Boolean).join(", ")}</Sub>
                {tenant.emiratesIdNo && <Sub className="font-mono">EID {tenant.emiratesIdNo}</Sub>}
              </FactVal>
            </>
          )}
          {landlord && (
            <>
              <FactKey>Landlord</FactKey>
              <FactVal>{landlord.fullNameEn}</FactVal>
            </>
          )}
        </FactList>
      </Section>

      <div className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 font-sans text-[15px] font-semibold tracking-tight">
            Contract and {l.registration?.systemName ?? "Ejari"}
          </h2>
          <AskAi compact prompt={contractAsk.prompt} label={contractAsk.label} page={{ kind: "lease", id: l.id }} />
        </div>
        <ContractPanel
          leaseId={l.id}
          state={l.state}
          contracts={l.contracts ?? []}
          canAct={canAct}
          options={l.clauseOptions}
          prepareNeeded={l.prepareNeeded ?? null}
        />
        <EjariPanel
          leaseId={l.id}
          state={l.state}
          attempts={l.ejari ?? []}
          systemName={l.registration?.systemName ?? "Ejari"}
          canAct={canAct}
          pendingApprovalId={ejariApproval?.id ?? null}
          mockUrl={demo ? (process.env.EJARI_MOCK_URL ?? "http://localhost:4100") : null}
          demo={demo}
          manual={manual}
          today={today}
        />
      </div>

      {moveOut && <MoveOutPanel leaseId={l.id} view={moveOut} role={me?.role ?? ""} today={health?.today ?? ""} />}
      {moveIn && <MoveInPanel leaseId={l.id} view={moveIn} canAct={canAct} active={l.state !== "MOVE_IN"} />}
      {(payments?.length ?? 0) > 0 && (
        <PaymentsPanel leaseId={l.id} rows={payments ?? []} role={me?.role ?? ""} today={today} />
      )}
      {!TENANCY_OPS && ["ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE", "CLOSED"].includes(l.state) && (
        <section aria-label="Tenancy operations">
          <TenancyOff />
        </section>
      )}
      {TENANCY_OPS && ["ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE"].includes(l.state) && (
        <ComplaintsPanel leaseId={l.id} rows={complaints ?? []} canAct={canAct} canLog={canAct} />
      )}
      {TENANCY_OPS && ["ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE", "CLOSED"].includes(l.state) && (
        <CasePanel
          key={caseDraft?.id ?? "case"}
          leaseId={l.id}
          state={l.state}
          role={me?.role ?? ""}
          summary={caseDraft ? { subject: caseDraft.subject, body: caseDraft.body } : null}
        />
      )}
      {canEmail && tenant && (
        <EmailTenantForm key={draft?.id ?? "new"} leaseId={l.id} tenantEmail={tenant.email} draft={draft} />
      )}

      <Section
        id="tl-h"
        title="Renewal path"
        hint={
          TENANCY_OPS && next && today ? (
            <>
              Next: {milestoneLabel(next.milestone).toLowerCase()} on {shortDate(next.dueOn)},{" "}
              <Due today={today} on={next.dueOn} />
            </>
          ) : undefined
        }
      >
        {!TENANCY_OPS ? (
          <TenancyOff />
        ) : l.deadlines.length ? (
          <RenewalTimeline deadlines={l.deadlines} startOn={l.startOn} endOn={l.endOn} today={today} />
        ) : (
          <p className="m-0 text-sm text-muted">Renewal milestones are scheduled when the lease becomes active.</p>
        )}
      </Section>
      {TENANCY_OPS ? (
        <RenewalPanel
          leaseId={l.id}
          state={l.state}
          approvals={l.approvals}
          outbound={l.outbound}
          inbound={l.inbound}
          tasks={l.tasks}
          canAct={canAct}
        />
      ) : null}

      <Section id="dl-h" title="Deadlines" hint="Asia/Dubai calendar days">
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="data">
            <thead>
              <tr>
                <th>Milestone</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {l.deadlines.map((d) => (
                <tr key={d.id}>
                  <td>
                    {milestoneLabel(d.milestone)}
                    {d.note && d.status !== "pending" && <Sub>{d.note}</Sub>}
                  </td>
                  <td className="nowrap">
                    {longDate(d.dueOn)}
                    {d.status === "pending" && today && (
                      <div>
                        <Due today={today} on={d.dueOn} />
                      </div>
                    )}
                  </td>
                  <td>
                    <Status value={d.status === "pending" ? "upcoming" : d.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {(l.approvals.length > 0 || openTasks.length > 0 || canAct) && (
        <Section id="work-h" title="Open work">
          <ul className={LIST}>
            {l.approvals.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/work?approval=${a.id}`}
                  className={`${ROW_CARD} flex items-center justify-between gap-3 text-sm hover:border-ink`}
                >
                  <span className="font-semibold">{a.title}</span>
                  <Status value={a.status} />
                </Link>
              </li>
            ))}
            {openTasks.map((t) => (
              <li key={t.id} className={`${ROW_CARD} grid gap-2`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div>{t.title}</div>
                    <Sub>
                      {roleLabel(t.assigneeRole)}
                      {t.dueOn && <span> by {shortDate(t.dueOn)}</span>}
                    </Sub>
                  </div>
                  <Status value="open" label="Task" />
                </div>
                {me && (
                  <TaskActions task={{ ...t, entityKind: "lease", entityId: l.id }} role={me.role} today={today} />
                )}
              </li>
            ))}
          </ul>
          {canAct && <AddTaskForm leaseId={l.id} today={today} />}
          {TENANCY_OPS && canAct && running && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold">Record a served 12-month notice</summary>
              <div className="mt-3">
                <VacateNoticeForm leaseId={l.id} today={today} />
              </div>
            </details>
          )}
        </Section>
      )}

      <details>
        <summary className="cursor-pointer text-[15px] font-semibold tracking-tight">
          Audit trail <span className="text-xs font-normal text-muted">append-only, every event</span>
        </summary>
        <ul className={`${LIST} mt-3`}>
          {l.events.toReversed().map((e) => (
            <li key={e.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 text-sm">
              <time dateTime={e.at} className="font-mono text-xs text-muted">
                {dateTime(e.at)}
              </time>
              <span>
                <b className="font-semibold">{eventLabel(e.type)}</b>
                {e.toState && <span> to {e.toState.toLowerCase().replace("_", " ")}</span>}
                {typeof e.payload.milestone === "string" && (
                  <span> {milestoneLabel(e.payload.milestone).toLowerCase()}</span>
                )}
                {typeof e.payload.title === "string" && <span> {e.payload.title}</span>}
                <span className="text-muted">, {actorLabel(e.actor).toLowerCase()}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
