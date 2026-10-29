import { TENANCY_OPS } from "../lib/env";
import { CasePanel } from "./case-panel";
import { MoveOutPanel, type MoveOutView } from "./move-out-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { Due, PlanPlaceholder, Status } from "./ui";
import { PageHead } from "./ui";
import { AddTaskForm, EmailTenantForm, TaskActions, VacateNoticeForm } from "./work-forms";
import { get, publicGet } from "../lib/engine";
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
  ejari: EjariAttempt[];
}

const TONE: Record<string, string> = {
  MILESTONE_FIRED: "good",
  APPROVAL_REQUESTED: "warn",
  TASK_CREATED: "warn",
};

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
  return <p className="muted panel-pad">{OFF_COPY}</p>;
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
  const canEmail = canAct || me?.role === "finance";
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

  return (
    <>
      <PageHead
        embedded
        title={
          <>
            {l.unit.code}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              {tenant?.fullNameEn}
            </span>
          </>
        }
        badge={<Status value={l.state} />}
        lede={
          <>
            Lease <span className="ref">{l.ref}</span>, {shortDate(l.startOn)} to {longDate(l.endOn)}. Rules{" "}
            <span className="ref">{l.rulesVersion}</span>.
          </>
        }
      />

      <section className="panel" aria-labelledby="tl-h">
        <div className="panel-head">
          <h2 id="tl-h">Renewal path</h2>
          {TENANCY_OPS && next && today && (
            <span className="hint">
              Next: {milestoneLabel(next.milestone).toLowerCase()} on {shortDate(next.dueOn)},{" "}
              <Due today={today} on={next.dueOn} />
            </span>
          )}
        </div>
        {!TENANCY_OPS ? (
          <TenancyOff />
        ) : l.deadlines.length ? (
          <RenewalTimeline deadlines={l.deadlines} startOn={l.startOn} endOn={l.endOn} today={today} />
        ) : (
          <p className="muted panel-pad">Renewal milestones are scheduled when the lease becomes active.</p>
        )}
      </section>

      <div className="split section">
        <div className="stack">
          {moveOut && <MoveOutPanel leaseId={l.id} view={moveOut} role={me?.role ?? ""} today={health?.today ?? ""} />}
          {moveIn && <MoveInPanel leaseId={l.id} view={moveIn} canAct={canAct} active={l.state !== "MOVE_IN"} />}
          {(payments?.length ?? 0) > 0 && (
            <PaymentsPanel leaseId={l.id} rows={payments ?? []} role={me?.role ?? ""} today={today} />
          )}
          {!TENANCY_OPS && ["ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE", "CLOSED"].includes(l.state) && (
            <section className="panel" aria-label="Tenancy operations">
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
          <ContractPanel
            leaseId={l.id}
            state={l.state}
            contracts={l.contracts ?? []}
            canAct={canAct}
            options={l.clauseOptions}
          />
          <EjariPanel
            leaseId={l.id}
            state={l.state}
            attempts={l.ejari ?? []}
            canAct={canAct}
            pendingApprovalId={ejariApproval?.id ?? null}
            mockUrl={demo ? (process.env.EJARI_MOCK_URL ?? "http://localhost:4100") : null}
            demo={demo}
          />
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
          <section className="panel" aria-labelledby="dl-h">
            <div className="panel-head">
              <h2 id="dl-h">Deadlines</h2>
              <span className="hint">Asia/Dubai calendar days</span>
            </div>
            <div className="table-wrap">
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
                        {d.note && d.status !== "pending" && <div className="row-sub">{d.note}</div>}
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
          </section>

          <section className="panel" aria-labelledby="act-h">
            <div className="panel-head">
              <h2 id="act-h">Activity</h2>
              <span className="hint">append-only audit trail</span>
            </div>
            <ul className="feed">
              {l.events.toReversed().map((e) => (
                <li key={e.id}>
                  <span
                    className="dot"
                    {...(e.toState ? { "data-tone": "good" } : TONE[e.type] ? { "data-tone": TONE[e.type] } : {})}
                  />
                  <span className="what">
                    <b>{eventLabel(e.type)}</b>
                    {e.toState && <span> to {e.toState.toLowerCase().replace("_", " ")}</span>}
                    {typeof e.payload.milestone === "string" && (
                      <span> {milestoneLabel(e.payload.milestone).toLowerCase()}</span>
                    )}
                    {typeof e.payload.title === "string" && <span> {e.payload.title}</span>}
                    <span>, {actorLabel(e.actor).toLowerCase()}</span>
                  </span>
                  <time dateTime={e.at}>{dateTime(e.at)}</time>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="stack">
          <Link href={`/units/${l.unit.id}`} className="unit-card" aria-label={`Unit ${l.unit.code}`}>
            <div className="media">
              {cover ? (
                <img
                  src={`/media/units/${l.unit.id}/${cover.id}`}
                  alt={cover.caption ?? `Unit ${l.unit.code}`}
                  loading="lazy"
                />
              ) : (
                <PlanPlaceholder bedrooms={l.unit.bedrooms} label="No photos yet" />
              )}
            </div>
            <div className="body">
              <div className="code">
                <b>{l.unit.code}</b>
                <span className="muted">{bedroomsLabel(l.unit.bedrooms)}</span>
              </div>
              <div className="where">
                {l.unit.building}, {l.unit.community}
              </div>
            </div>
          </Link>

          <section className="panel panel-pad" aria-labelledby="terms-h">
            <h2 id="terms-h" className="section-title">
              Terms
            </h2>
            <dl className="facts">
              <dt>Annual rent</dt>
              <dd className="num">{aedShort(l.annualRentFils)}</dd>
              <dt>Cheques</dt>
              <dd>{l.cheques}</dd>
              <dt>Deposit</dt>
              <dd className="num">{aedShort(l.depositFils)}</dd>
              <dt>Ejari</dt>
              <dd className="ref">{l.ejariNo ?? "Not registered"}</dd>
            </dl>
          </section>

          <section className="panel panel-pad" aria-labelledby="people-h">
            <h2 id="people-h" className="section-title">
              People
            </h2>
            <dl className="facts">
              {tenant && (
                <>
                  <dt>Tenant</dt>
                  <dd>
                    {tenant.fullNameEn}
                    <div className="row-sub">{[tenant.email, tenant.phone].filter(Boolean).join(", ")}</div>
                    {tenant.emiratesIdNo && <div className="row-sub ref">EID {tenant.emiratesIdNo}</div>}
                  </dd>
                </>
              )}
              {landlord && (
                <>
                  <dt>Landlord</dt>
                  <dd>{landlord.fullNameEn}</dd>
                </>
              )}
            </dl>
          </section>

          {(l.approvals.length > 0 || openTasks.length > 0 || canAct) && (
            <section className="panel" aria-labelledby="work-h">
              <div className="panel-head">
                <h2 id="work-h">Open work</h2>
                {canAct && <AddTaskForm leaseId={l.id} today={today} />}
              </div>
              <ul className="list" style={{ marginTop: 6 }}>
                {l.approvals.map((a) => (
                  <li key={a.id}>
                    <Link href={`/work?approval=${a.id}`} className="list-row">
                      <span className="title">{a.title}</span>
                      <Status value={a.status} />
                    </Link>
                  </li>
                ))}
                {openTasks.map((t) => (
                  <li key={t.id} className="list-row">
                    <div>
                      <div>{t.title}</div>
                      <div className="meta">
                        {roleLabel(t.assigneeRole)}
                        {t.dueOn && <span>by {shortDate(t.dueOn)}</span>}
                      </div>
                      {me && (
                        <TaskActions
                          task={{ ...t, entityKind: "lease", entityId: l.id }}
                          role={me.role}
                          today={today}
                        />
                      )}
                    </div>
                    <Status value="open" label="Task" />
                  </li>
                ))}
              </ul>
              {TENANCY_OPS && canAct && running && (
                <details className="panel-pad">
                  <summary>Record a served 12-month notice</summary>
                  <VacateNoticeForm leaseId={l.id} today={today} />
                </details>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
