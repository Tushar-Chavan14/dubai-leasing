"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import {
  completeMoveIn,
  logComplaint,
  proposeFormal,
  recordPayment,
  resolveComplaint,
  type TenancyActionState,
  tickItem,
} from "../app/(staff)/leases/[id]/tenancy-actions";
import { aedShort, longDate, shortDate } from "../lib/format";
import { IconCheck, IconWarning } from "../lib/icons";
import { checkPhotoFile, preparePhoto } from "../lib/images";
import { Status } from "./ui";

export function Result({ s }: { s: TenancyActionState }) {
  if (s.ok)
    return (
      <div className="alert" data-tone="good" role="status">
        <IconCheck size={16} />
        {s.ok}
      </div>
    );
  if (s.error)
    return (
      <div className="alert" data-tone="bad" role="alert">
        <IconWarning size={16} />
        <div>
          <strong>{s.error}</strong>
          {s.reasons?.length ? (
            <ul>
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  return null;
}

// ---------------------------------------------------------------- move-in

export interface MoveInView {
  inspectionId: string;
  status: string;
  items: { id: string; label: string; kind: "check" | "room"; done: boolean }[];
  photos: { id: string; room: string | null; kind: string }[];
  missing: string[];
  ejariNo: string | null;
}

/** Step 7: tick what was handed over, photograph every room, then complete the move-in. */
export function MoveInPanel({
  leaseId,
  view,
  canAct,
  active,
}: {
  leaseId: string;
  view: MoveInView;
  canAct: boolean;
  active: boolean;
}) {
  const [tickState, tick, ticking] = useActionState<TenancyActionState, FormData>(tickItem, {});
  const [doneState, complete, completing] = useActionState<TenancyActionState, FormData>(completeMoveIn, {});
  const [upload, setUpload] = useState<{ room: string; error?: string; busy?: boolean } | null>(null);
  const router = useRouter();

  async function addPhoto(room: string, file: File) {
    const problem = checkPhotoFile(file);
    if (problem) return setUpload({ room, error: problem });
    setUpload({ room, busy: true });
    const form = new FormData();
    form.set("room", room);
    form.set("file", new File([await preparePhoto(file)], "condition.jpg", { type: "image/jpeg" }));
    const res = await fetch(`/api/leases/${leaseId}/move-in/photos`, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return setUpload({ room, error: body.error ?? "Upload failed." });
    }
    setUpload(null);
    router.refresh();
  }

  const checks = view.items.filter((i) => i.kind === "check");
  const rooms = view.items.filter((i) => i.kind === "room");
  return (
    <section className="panel" aria-labelledby="mi-h">
      <div className="panel-head">
        <h2 id="mi-h">Move-in checklist</h2>
        <span className="hint">{active ? "Completed" : `${view.missing.length} item(s) left`}</span>
      </div>
      <div className="panel-pad stack">
        <ul className="checklist">
          <li data-done={view.ejariNo ? "" : undefined}>
            {view.ejariNo ? <IconCheck size={14} /> : <IconWarning size={14} />} Ejari{" "}
            {view.ejariNo ?? "number missing"}
          </li>
          {checks.map((i) => (
            <li key={i.id} data-done={i.done ? "" : undefined}>
              {canAct && !active ? (
                <form action={tick} style={{ display: "inline" }}>
                  <input type="hidden" name="leaseId" value={leaseId} />
                  <input type="hidden" name="item" value={i.id} />
                  <input type="hidden" name="done" value={String(!i.done)} />
                  <button type="submit" className="btn small" disabled={ticking} aria-pressed={i.done}>
                    {i.done ? "✓" : "Tick"}
                  </button>
                </form>
              ) : i.done ? (
                <IconCheck size={14} />
              ) : null}{" "}
              {i.label}
            </li>
          ))}
        </ul>
        <div>
          <h3 className="section-title" style={{ fontSize: 14 }}>
            Condition photos
          </h3>
          <ul className="list">
            {rooms.map((r) => {
              const shots = view.photos.filter((p) => p.room === r.label && p.kind === "condition_photo");
              const tenantShots = view.photos.filter((p) => p.room === r.label && p.kind === "tenant_condition_photo");
              return (
                <li key={r.id} className="list-row">
                  <div>
                    <div className="title">
                      {r.done ? <IconCheck size={14} /> : <IconWarning size={14} />} {r.label}
                    </div>
                    <div className="meta">
                      {shots.map((p, n) => (
                        <a
                          key={p.id}
                          className="link"
                          href={`/api/leases/${leaseId}/photos/${p.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          photo {n + 1}
                        </a>
                      ))}
                      {tenantShots.map((p, n) => (
                        <a
                          key={p.id}
                          className="link"
                          href={`/api/leases/${leaseId}/photos/${p.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          tenant's photo {n + 1}
                        </a>
                      ))}
                      {upload?.room === r.label && upload.error ? <span className="muted">{upload.error}</span> : null}
                    </div>
                  </div>
                  {canAct && !active && (
                    <label className="btn small">
                      {upload?.room === r.label && upload.busy ? "Uploading…" : "Add photo"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void addPhoto(r.label, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {canAct && !active && (
          <form action={complete}>
            <input type="hidden" name="leaseId" value={leaseId} />
            <button type="submit" className="btn primary" disabled={completing || view.missing.length > 0}>
              Complete move-in
            </button>
            {view.missing.length > 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Still missing: {view.missing.join("; ")}.
              </p>
            )}
          </form>
        )}
        <Result s={tickState} />
        <Result s={doneState} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- payments

export interface PaymentRow {
  id: string;
  seq: number;
  dueOn: string;
  amountFils: number;
  method: string;
  status: string;
  paidOn: string | null;
  paidRef: string | null;
  bouncedOn: string | null;
  friendlyCount: number;
  formalReminderSentOn: string | null;
  evictionEligibleOn: string | null;
}

/** Step 8: instalments; finance confirms each, records a bounce, and may propose a formal reminder. */
export function PaymentsPanel({
  leaseId,
  rows,
  role,
  today,
}: {
  leaseId: string;
  rows: PaymentRow[];
  role: string;
  today: string;
}) {
  const [recState, record, recording] = useActionState<TenancyActionState, FormData>(recordPayment, {});
  const [formalState, formal, proposing] = useActionState<TenancyActionState, FormData>(proposeFormal, {});
  const [open, setOpen] = useState<string | null>(null);
  const canRecord = role === "finance" || role === "leasing_manager";
  const canPropose = canRecord || role === "leasing_officer";
  return (
    <section className="panel" aria-labelledby="pay-h">
      <div className="panel-head">
        <h2 id="pay-h">Rent payments</h2>
        <span className="hint">Finance confirms every payment</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted panel-pad">Instalments are created when the tenant moves in.</p>
      ) : (
        <ul className="list">
          {rows.map((p) => {
            const isOpen = p.status === "scheduled" || p.status === "overdue" || p.status === "bounced";
            // Assumed paid when the lease was imported: finance checks it and can still record a bounce.
            const assumed = p.status === "paid" && p.paidRef === "assumed paid at import";
            return (
              <li key={p.id} className="list-row" style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div className="title">
                      {p.seq}. {aedShort(p.amountFils)} · due {shortDate(p.dueOn)}
                    </div>
                    <div className="meta">
                      {p.paidOn && (
                        <span>
                          paid {shortDate(p.paidOn)}
                          {p.paidRef ? ` (${p.paidRef})` : ""}
                        </span>
                      )}
                      {assumed && <span>assumed paid at import · finance to check</span>}
                      {p.bouncedOn && <span>bounced {shortDate(p.bouncedOn)}</span>}
                      {p.friendlyCount > 0 && <span>{p.friendlyCount} reminder(s)</span>}
                      {p.formalReminderSentOn && (
                        <span>
                          formal reminder {shortDate(p.formalReminderSentOn)} · waiting period ends{" "}
                          {longDate(p.evictionEligibleOn ?? "")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="side">
                    <Status value={p.status} />
                    {(isOpen || assumed) && canRecord && (
                      <button type="button" className="btn small" onClick={() => setOpen(open === p.id ? null : p.id)}>
                        Record
                      </button>
                    )}
                  </div>
                </div>
                {open === p.id && (
                  <div className="stack" style={{ marginTop: 10 }}>
                    {isOpen && (
                      <form action={record} className="btn-row">
                        <input type="hidden" name="leaseId" value={leaseId} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="outcome" value="paid" />
                        <input
                          type="date"
                          name="paidOn"
                          defaultValue={today}
                          max={today}
                          required
                          aria-label="Paid on"
                        />
                        <input name="ref" placeholder="Reference" required maxLength={120} aria-label="Reference" />
                        <button type="submit" className="btn small primary" disabled={recording}>
                          Paid
                        </button>
                      </form>
                    )}
                    {p.method === "cheque" && p.status !== "bounced" && p.dueOn <= today && (
                      <form action={record}>
                        <input type="hidden" name="leaseId" value={leaseId} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="outcome" value="bounced" />
                        <button type="submit" className="btn small" disabled={recording}>
                          Cheque bounced
                        </button>
                      </form>
                    )}
                  </div>
                )}
                {(p.status === "overdue" || p.status === "bounced") && !p.formalReminderSentOn && canPropose && (
                  <form action={formal} style={{ marginTop: 8 }}>
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button type="submit" className="btn small" disabled={proposing}>
                      Propose formal reminder
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="panel-pad">
        <Result s={recState} />
        <Result s={formalState} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- complaints

export interface ComplaintRow {
  id: string;
  ref: string | null;
  text: string;
  room: string | null;
  atRisk: boolean;
  source: string;
  category: string | null;
  urgency: number | null;
  status: string;
  createdAt: string;
  ticket: { id: string; ref: string; status: string; dueBy: string } | null;
}

const CATEGORIES = ["ac", "plumbing", "electrical", "pest", "noise", "appliances", "building", "billing"];
const URGENCY = ["Can wait a week", "Within 48 hours", "Same day", "Emergency"];

/** Step 8: the tenant's reports, their triage and tickets; log one for the tenant. */
export function ComplaintsPanel({
  leaseId,
  rows,
  canAct,
  canLog,
}: {
  leaseId: string;
  rows: ComplaintRow[];
  canAct: boolean;
  canLog: boolean;
}) {
  const [resState, resolve, resolving] = useActionState<TenancyActionState, FormData>(resolveComplaint, {});
  const [logState, log, logging] = useActionState<TenancyActionState, FormData>(logComplaint, {});
  const [showLog, setShowLog] = useState(false);
  return (
    <section className="panel" aria-labelledby="cmp-h">
      <div className="panel-head">
        <h2 id="cmp-h">Issues and maintenance</h2>
        {canLog && (
          <button type="button" className="btn small" onClick={() => setShowLog(!showLog)}>
            Log an issue
          </button>
        )}
      </div>
      {showLog && (
        <form action={log} className="panel-pad stack">
          <input type="hidden" name="leaseId" value={leaseId} />
          <label className="field">
            <span className="field-label">What the tenant reported</span>
            <textarea name="description" rows={3} maxLength={2000} required />
          </label>
          <label className="field">
            <span className="field-label">Room</span>
            <input name="room" maxLength={60} />
          </label>
          <label>
            <input type="checkbox" name="atRisk" /> Someone is at risk
          </label>
          <div>
            <button type="submit" className="btn primary small" disabled={logging}>
              Log it
            </button>
          </div>
          <Result s={logState} />
        </form>
      )}
      {rows.length === 0 ? (
        <p className="muted panel-pad">No issues reported.</p>
      ) : (
        <ul className="list">
          {rows.map((c) => (
            <li key={c.id} className="list-row" style={{ display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="title" dir="auto">
                    {c.atRisk && <IconWarning size={14} />} {c.text.slice(0, 160)}
                  </div>
                  <div className="meta">
                    <span className="ref">{c.ref}</span>
                    {c.category && <span>{c.category}</span>}
                    {c.urgency !== null && <span>{URGENCY[c.urgency]}</span>}
                    {c.room && <span>{c.room}</span>}
                    {c.ticket && (
                      <span>
                        ticket {c.ticket.ref} · {c.ticket.status} · due{" "}
                        {new Date(c.ticket.dueBy).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}
                      </span>
                    )}
                    <span>{c.source === "staff" ? "logged by staff" : "from the portal"}</span>
                  </div>
                </div>
                <Status value={c.status} />
              </div>
              {canAct && c.status === "review" && (
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <form action={resolve} className="btn-row">
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="complaintId" value={c.id} />
                    <input type="hidden" name="action" value="ticket" />
                    <select name="category" aria-label="Category" defaultValue="building">
                      {CATEGORIES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <select name="urgency" aria-label="Urgency" defaultValue="1">
                      {URGENCY.map((u, i) => (
                        <option key={u} value={i}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn small primary" disabled={resolving}>
                      Open ticket
                    </button>
                  </form>
                  <form action={resolve} className="btn-row">
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="complaintId" value={c.id} />
                    <input type="hidden" name="action" value="close" />
                    <input name="reason" placeholder="Why it's closed" required minLength={3} aria-label="Reason" />
                    <button type="submit" className="btn small" disabled={resolving}>
                      Close
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="panel-pad">
        <Result s={resState} />
      </div>
    </section>
  );
}
