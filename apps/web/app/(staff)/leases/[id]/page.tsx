import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractPanel, type ContractRow, type EjariAttempt, EjariPanel } from "../../../../components/contract-panel";
import { type InboundRow, type OutboundRow, RenewalPanel } from "../../../../components/renewal-panel";
import { RenewalTimeline } from "../../../../components/renewal-timeline";
import { Due, PlanPlaceholder, Status } from "../../../../components/ui";
import { PageHead } from "../../../../components/ui";
import { get, publicGet } from "../../../../lib/engine";
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
} from "../../../../lib/format";
import type { Me, UnitDetail } from "../../../../lib/types";

export const metadata: Metadata = { title: "Lease" };

interface LeaseDetail {
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
  ejari: EjariAttempt[];
}

const TONE: Record<string, string> = {
  MILESTONE_FIRED: "good",
  APPROVAL_REQUESTED: "warn",
  TASK_CREATED: "warn",
};

export default async function LeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await get<LeaseDetail>(`/api/leases/${id}`);
  if (!l) notFound();
  const [health, unit, me] = await Promise.all([
    publicGet<{ today: string; demoMode: boolean }>("/health"),
    get<UnitDetail>(`/api/units/${l.unit.id}`),
    get<Me>("/api/me"),
  ]);
  const canAct = me?.role === "leasing_officer" || me?.role === "leasing_manager";
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
        back={{ href: "/leases", label: "Leases" }}
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
          {next && today && (
            <span className="hint">
              Next: {milestoneLabel(next.milestone).toLowerCase()} on {shortDate(next.dueOn)},{" "}
              <Due today={today} on={next.dueOn} />
            </span>
          )}
        </div>
        {l.deadlines.length ? (
          <RenewalTimeline deadlines={l.deadlines} startOn={l.startOn} endOn={l.endOn} today={today} />
        ) : (
          <p className="muted panel-pad">Renewal milestones are scheduled when the lease becomes active.</p>
        )}
      </section>

      <div className="split section">
        <div className="stack">
          <ContractPanel leaseId={l.id} state={l.state} contracts={l.contracts ?? []} canAct={canAct} />
          <EjariPanel
            leaseId={l.id}
            state={l.state}
            attempts={l.ejari ?? []}
            canAct={canAct}
            pendingApprovalId={ejariApproval?.id ?? null}
            mockUrl={demo ? (process.env.EJARI_MOCK_URL ?? "http://localhost:4100") : null}
            demo={demo}
          />
          <RenewalPanel
            leaseId={l.id}
            state={l.state}
            approvals={l.approvals}
            outbound={l.outbound}
            inbound={l.inbound}
            tasks={l.tasks}
            canAct={canAct}
          />
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

          {(l.approvals.length > 0 || openTasks.length > 0) && (
            <section className="panel" aria-labelledby="work-h">
              <div className="panel-head">
                <h2 id="work-h">Open work</h2>
              </div>
              <ul className="list" style={{ marginTop: 6 }}>
                {l.approvals.map((a) => (
                  <li key={a.id}>
                    <Link href={`/inbox/${a.id}`} className="list-row">
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
                    </div>
                    <Status value="open" label="Task" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
