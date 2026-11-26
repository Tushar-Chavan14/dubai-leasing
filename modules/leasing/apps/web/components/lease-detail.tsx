import type { ChangeRequestRow } from "./contract-change-requests";
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
import { Fact, FactGrid, ROW_CARD, Section, Sub } from "@platform/ui/record";
import { AddTaskFab, EmailTenantForm, TaskActions, VacateNoticeForm } from "./work-forms";
import type { PreparingStatus } from "../lib/contract-preparing";
import { engine, get, publicGet } from "../lib/engine";
import { aedShort, bedroomsLabel, longDate, milestoneLabel, roleLabel, shortDate } from "../lib/format";
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
  /** D75: a flat renewal cap needs no rent index value. */
  renewalCap?: { indexNeeded: boolean; flatPercent: number | null; rulesVersion: string | null };
  prepareNeeded?: "failed" | "rejected" | "not_prepared" | "rules_changed" | null;
  preparing?: PreparingStatus | null;
  changeRequests?: ChangeRequestRow[];
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
/** `activity` (the Workspace's log) comes last, after the lease's details. */
export async function LeaseDetail({
  id,
  draftId,
  activity,
}: {
  id: string;
  draftId?: string | undefined;
  activity?: ReactNode;
}) {
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

  const LIST = "m-0 grid list-none gap-1.5 p-0";
  const openApprovals = l.approvals.filter((a) => a.status === "pending");
  // The agent's own reminders (timed:…) are not deadlines anyone acts on; only real milestones are shown.
  const milestones = l.deadlines.filter((d) => !d.milestone.startsWith("timed:"));
  return (
    <div className="grid gap-4">
      <Section
        id="overview-h"
        title={
          <span className="inline-flex items-center gap-2">
            Overview <Status value={l.state} />
          </span>
        }
      >
        <FactGrid>
          <Fact label="Lease" mono>
            {l.ref}
          </Fact>
          <Fact label="Term">
            {shortDate(l.startOn)} to {longDate(l.endOn)}
          </Fact>
          <Fact label="Rules version" mono>
            {l.rulesVersion}
          </Fact>
          <Fact label="Annual rent">{aedShort(l.annualRentFils)}</Fact>
          <Fact label="Cheques">{l.cheques}</Fact>
          <Fact label="Deposit">{aedShort(l.depositFils)}</Fact>
          <Fact label={l.registration?.systemName ?? "Ejari"} mono={!!l.ejariNo}>
            {l.ejariNo ?? "Not registered"}
          </Fact>
          {tenant && (
            <Fact label="Tenant">
              {tenant.fullNameEn}
              <Sub className="font-normal">{[tenant.email, tenant.phone].filter(Boolean).join(", ")}</Sub>
              {tenant.emiratesIdNo && <Sub className="font-mono font-normal">EID {tenant.emiratesIdNo}</Sub>}
            </Fact>
          )}
          {landlord && <Fact label="Landlord">{landlord.fullNameEn}</Fact>}
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

      {/* Documents, as on an application: the contract and its registration are sub-sections of one card. */}
      <Section
        id="docs-h"
        title="Documents"
        hint={`Contract and ${l.registration?.systemName ?? "Ejari"}`}
        className="gap-6"
      >
        <ContractPanel
          leaseId={l.id}
          state={l.state}
          contracts={l.contracts ?? []}
          canAct={canAct}
          options={l.clauseOptions}
          prepareNeeded={l.prepareNeeded ?? null}
          preparing={l.preparing ?? null}
          changeRequests={l.changeRequests ?? []}
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
      </Section>

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

      {TENANCY_OPS ? (
        <RenewalPanel
          leaseId={l.id}
          state={l.state}
          approvals={l.approvals}
          outbound={l.outbound}
          inbound={l.inbound}
          tasks={l.tasks}
          canAct={canAct}
          renewalCap={l.renewalCap}
        />
      ) : null}

      {/* Deadlines and the renewal path are one story: a renewal is driven by its deadlines. */}
      {milestones.length > 0 && (
        <Section
          id="dl-h"
          title="Deadlines and renewal"
          hint={
            TENANCY_OPS && next && today ? (
              <>
                Asia/Dubai calendar days · next: {milestoneLabel(next.milestone).toLowerCase()} on{" "}
                {shortDate(next.dueOn)}, <Due today={today} on={next.dueOn} />
              </>
            ) : (
              "Asia/Dubai calendar days"
            )
          }
        >
          {!TENANCY_OPS ? (
            <p className="m-0 text-[13px] text-muted">
              Renewals are switched off for this account, so no renewal path is shown.
            </p>
          ) : l.deadlines.length ? (
            <RenewalTimeline deadlines={milestones} startOn={l.startOn} endOn={l.endOn} today={today} />
          ) : (
            <p className="m-0 text-[13px] text-muted">
              Renewal milestones are scheduled when the lease becomes active.
            </p>
          )}
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
                {milestones.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {milestoneLabel(d.milestone)}
                      {/* A scheduled reminder's note is its stored job (JSON): not for people. */}
                      {d.note && d.status !== "pending" && !d.note.trimStart().startsWith("{") && <Sub>{d.note}</Sub>}
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
      )}

      {(openApprovals.length > 0 || openTasks.length > 0 || (TENANCY_OPS && canAct && running)) && (
        <Section id="work-h" title="Open work">
          <ul className={LIST}>
            {openApprovals.map((a) => (
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

      {activity}
      {canAct && <AddTaskFab leaseId={l.id} today={today} />}
    </div>
  );
}
