"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import {
  addDamage,
  compareRooms,
  completeMoveOut,
  recordRefund,
  reissueStatement,
  removeDamage,
  showRefundAccount,
  type TenancyActionState,
  tickMoveOutItem,
} from "../app/(staff)/leases/[id]/tenancy-actions";
import { aedShort, longDate } from "../lib/format";
import { IconCheck, IconWarning } from "../lib/icons";
import { checkPhotoFile, preparePhoto } from "../lib/images";
import { Result } from "./tenancy-panels";
import { Status } from "./ui";

export interface MoveOutView {
  status: string;
  scheduledAt: string | null;
  moveOutOn: string;
  items: { id: string; label: string; kind: "check" | "room"; done: boolean }[];
  rooms: { room: string; moveIn: string[]; moveOut: string[] }[];
  suggestions: {
    room: string;
    status: "pending" | "ok" | "needs_human";
    suggestions: { itemId: string; label: string; quantity: number; description: string; confidence: number }[];
    reasons: string[];
  }[];
  findings: {
    id: string;
    room: string | null;
    itemId: string;
    quantity: number;
    otherLabel?: string;
    otherAmountFils?: number;
    fromSuggestion: boolean;
  }[];
  findingsEditable: boolean;
  priceList: { id: string; label: string; unit: string; priceFils: number }[];
  statement: {
    revision: number;
    status: string;
    depositFils: number;
    deductionsFils: number;
    refundFils: number;
    owedFils: number;
    needsApproval: boolean;
    documentId: string | null;
    paidOn: string | null;
  } | null;
  missing: string[];
  depositFils: number;
  ejariNo: string | null;
  ejariCancelledOn: string | null;
  depositSettledOn: string | null;
}

const dubaiTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/**
 * Step 10: the move-out inspection (photos side by side with move-in, vision suggestions an
 * officer confirms or ignores), the deposit statement, and finance's refund record.
 */
export function MoveOutPanel({
  leaseId,
  view,
  role,
  today,
}: {
  leaseId: string;
  view: MoveOutView;
  role: string;
  today: string;
}) {
  const canAct = role === "leasing_officer" || role === "leasing_manager";
  const isFinance = role === "finance";
  const open = view.status !== "done";
  const [tickState, tick, ticking] = useActionState<TenancyActionState, FormData>(tickMoveOutItem, {});
  const [cmpState, compare, comparing] = useActionState<TenancyActionState, FormData>(compareRooms, {});
  const [addState, add, adding] = useActionState<TenancyActionState, FormData>(addDamage, {});
  const [rmState, remove] = useActionState<TenancyActionState, FormData>(removeDamage, {});
  const [doneState, complete, completing] = useActionState<TenancyActionState, FormData>(completeMoveOut, {});
  const [reState, reissue, reissuing] = useActionState<TenancyActionState, FormData>(reissueStatement, {});
  const [payState, pay, paying] = useActionState<TenancyActionState, FormData>(recordRefund, {});
  const [acctState, showAccount, showing] = useActionState<TenancyActionState, FormData>(showRefundAccount, {});
  const [upload, setUpload] = useState<{ room: string; error?: string; busy?: boolean } | null>(null);
  const [item, setItem] = useState("");
  const router = useRouter();

  async function addPhoto(room: string, file: File) {
    const problem = checkPhotoFile(file);
    if (problem) return setUpload({ room, error: problem });
    setUpload({ room, busy: true });
    const form = new FormData();
    form.set("room", room);
    form.set("file", new File([await preparePhoto(file)], "move-out.jpg", { type: "image/jpeg" }));
    const res = await fetch(`/api/leases/${leaseId}/move-out/photos`, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return setUpload({ room, error: body.error ?? "Upload failed." });
    }
    setUpload(null);
    router.refresh();
  }

  const label = (id: string) => view.priceList.find((p) => p.id === id)?.label ?? id;
  const photoLinks = (ids: string[], what: string) =>
    ids.map((id, n) => (
      <a key={id} className="link" href={`/api/leases/${leaseId}/photos/${id}`} target="_blank" rel="noreferrer">
        {what} {n + 1}
      </a>
    ));
  const s = view.statement;
  const payable = s && (s.status === "approved" || (s.status === "accepted" && !s.needsApproval));

  return (
    <section className="panel" aria-labelledby="mo-h">
      <div className="panel-head">
        <h2 id="mo-h">Move-out</h2>
        <span className="hint">
          Moving out {longDate(view.moveOutOn)}
          {view.scheduledAt ? `, inspection ${dubaiTime(view.scheduledAt)}` : ", inspection not booked"}
        </span>
      </div>
      <div className="panel-pad stack">
        <ul className="checklist">
          {view.items
            .filter((i) => i.kind === "check")
            .map((i) => (
              <li key={i.id} data-done={i.done ? "" : undefined}>
                {canAct && open ? (
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
          <li data-done={view.ejariCancelledOn ? "" : undefined}>
            {view.ejariCancelledOn ? <IconCheck size={14} /> : <IconWarning size={14} />} Ejari{" "}
            {view.ejariNo
              ? view.ejariCancelledOn
                ? `${view.ejariNo} cancelled ${longDate(view.ejariCancelledOn)}`
                : `${view.ejariNo} active (cancelled automatically from the move-out date)`
              : "none on record"}
          </li>
        </ul>

        <div>
          <h3 className="section-title" style={{ fontSize: 14 }}>
            Rooms: move-in and move-out photos
          </h3>
          <ul className="list">
            {view.rooms.map((r) => {
              const sug = view.suggestions.find((x) => x.room === r.room);
              return (
                <li key={r.room} className="list-row">
                  <div>
                    <div className="title">
                      {r.moveOut.length ? <IconCheck size={14} /> : <IconWarning size={14} />} {r.room}
                    </div>
                    <div className="meta">
                      {r.moveIn.length ? (
                        photoLinks(r.moveIn, "move-in")
                      ) : (
                        <span className="muted">no move-in photo</span>
                      )}
                      {photoLinks(r.moveOut, "move-out")}
                      {upload?.room === r.room && upload.error ? <span className="muted">{upload.error}</span> : null}
                    </div>
                    {sug && (
                      <div className="meta" style={{ display: "block" }}>
                        {sug.status === "pending" && <span className="muted">Comparing…</span>}
                        {sug.status === "needs_human" && <span className="muted">{sug.reasons.join(" ")}</span>}
                        {sug.status === "ok" && !sug.suggestions.length && (
                          <span className="muted">No clear damage seen (suggestion only).</span>
                        )}
                        {sug.suggestions.map((x, n) => (
                          <form key={n} action={add} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input type="hidden" name="leaseId" value={leaseId} />
                            <input type="hidden" name="room" value={r.room} />
                            <input type="hidden" name="itemId" value={x.itemId} />
                            <input type="hidden" name="quantity" value={x.quantity} />
                            <input type="hidden" name="fromSuggestion" value="true" />
                            <span>
                              Suggestion: {x.label} × {x.quantity}, “{x.description}” ({Math.round(x.confidence * 100)}
                              %)
                            </span>
                            {canAct && view.findingsEditable && (
                              <button type="submit" className="btn small" disabled={adding}>
                                Confirm
                              </button>
                            )}
                          </form>
                        ))}
                      </div>
                    )}
                  </div>
                  {canAct && open && (
                    <label className="btn small">
                      {upload?.room === r.room && upload.busy ? "Uploading…" : "Add photo"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void addPhoto(r.room, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          {canAct && open && (
            <form action={compare}>
              <input type="hidden" name="leaseId" value={leaseId} />
              <button type="submit" className="btn small" disabled={comparing}>
                Compare with move-in photos
              </button>
              <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>
                Local vision model; suggestions only. Normal wear and tear is not damage.
              </span>
            </form>
          )}
        </div>

        <div>
          <h3 className="section-title" style={{ fontSize: 14 }}>
            Confirmed damage
          </h3>
          {view.findings.length ? (
            <ul className="list">
              {view.findings.map((f) => {
                const price = view.priceList.find((p) => p.id === f.itemId)?.priceFils ?? f.otherAmountFils ?? 0;
                return (
                  <li key={f.id} className="list-row">
                    <div>
                      <div className="title">
                        {f.room ? `${f.room}: ` : ""}
                        {f.itemId === "other" ? f.otherLabel : label(f.itemId)} × {f.quantity}
                      </div>
                      <div className="meta">
                        {aedShort(price * f.quantity)}
                        {f.itemId === "other" ? " · not on the price list: finance approves" : ""}
                        {f.fromSuggestion ? " · from a suggestion" : ""}
                      </div>
                    </div>
                    {canAct && view.findingsEditable && (
                      <form action={remove}>
                        <input type="hidden" name="leaseId" value={leaseId} />
                        <input type="hidden" name="findingId" value={f.id} />
                        <button type="submit" className="btn small">
                          Remove
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              None. The full deposit of {aedShort(view.depositFils)} is refunded.
            </p>
          )}
          {canAct && view.findingsEditable && (
            <form action={add} className="stack" style={{ marginTop: 10 }}>
              <input type="hidden" name="leaseId" value={leaseId} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select name="room" defaultValue="">
                  <option value="">Whole unit</option>
                  {view.rooms.map((r) => (
                    <option key={r.room}>{r.room}</option>
                  ))}
                </select>
                <select name="itemId" value={item} onChange={(e) => setItem(e.target.value)} required>
                  <option value="">Price-list item…</option>
                  {view.priceList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({aedShort(p.priceFils)} per {p.unit})
                    </option>
                  ))}
                  <option value="other">Other (finance approves)</option>
                </select>
                <input name="quantity" type="number" min={1} max={999} defaultValue={1} style={{ width: 70 }} />
              </div>
              {item === "other" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input name="otherLabel" placeholder="What is it?" maxLength={120} required />
                  <input
                    name="otherAed"
                    type="number"
                    min={1}
                    step="0.01"
                    placeholder="AED"
                    required
                    style={{ width: 110 }}
                  />
                </div>
              )}
              <button type="submit" className="btn small" disabled={adding} style={{ width: "fit-content" }}>
                Add damage item
              </button>
            </form>
          )}
        </div>

        {canAct && open && (
          <form action={complete}>
            <input type="hidden" name="leaseId" value={leaseId} />
            <button type="submit" className="btn primary" disabled={completing || view.missing.length > 0}>
              Complete inspection and send the deposit statement
            </button>
            {view.missing.length > 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Still missing: {view.missing.join("; ")}.
              </p>
            )}
          </form>
        )}

        {s && (
          <div>
            <h3 className="section-title" style={{ fontSize: 14 }}>
              Deposit statement {s.revision} <Status value={s.status} />
            </h3>
            <dl className="facts">
              <dt>Deposit</dt>
              <dd>{aedShort(s.depositFils)}</dd>
              <dt>Deductions</dt>
              <dd>{aedShort(s.deductionsFils)}</dd>
              <dt>Refund</dt>
              <dd>
                <b>{aedShort(s.refundFils)}</b>
                {s.needsApproval ? " · finance approval needed" : ""}
              </dd>
              {s.owedFils > 0 && (
                <>
                  <dt>Beyond the deposit</dt>
                  <dd>{aedShort(s.owedFils)} (a manager decides)</dd>
                </>
              )}
            </dl>
            {s.documentId && (
              <a
                className="link"
                href={`/api/leases/${leaseId}/documents/${s.documentId}`}
                target="_blank"
                rel="noreferrer"
              >
                Statement PDF
              </a>
            )}
            {canAct && s.status === "superseded" && (
              <form action={reissue}>
                <input type="hidden" name="leaseId" value={leaseId} />
                <button type="submit" className="btn small" disabled={reissuing}>
                  Reissue corrected statement
                </button>
              </form>
            )}
            {isFinance && payable && (
              <form action={showAccount} style={{ marginTop: 8 }}>
                <input type="hidden" name="leaseId" value={leaseId} />
                <button type="submit" className="btn small" disabled={showing}>
                  Show refund account
                </button>
                <Result s={acctState} />
              </form>
            )}
            {isFinance && payable && (
              <form action={pay} style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 8 }}>
                <input type="hidden" name="leaseId" value={leaseId} />
                <label className="field">
                  <span className="field-label">Paid on</span>
                  <input type="date" name="paidOn" max={today} defaultValue={today} required />
                </label>
                <label className="field">
                  <span className="field-label">Bank reference</span>
                  <input name="ref" maxLength={120} required />
                </label>
                <button type="submit" className="btn primary small" disabled={paying}>
                  Record refund paid
                </button>
              </form>
            )}
            {s.paidOn && <p className="muted">Refund paid {longDate(s.paidOn)}.</p>}
          </div>
        )}
        {[tickState, cmpState, addState, rmState, doneState, reState, payState].map((st, n) => (
          <Result key={n} s={st} />
        ))}
      </div>
    </section>
  );
}
