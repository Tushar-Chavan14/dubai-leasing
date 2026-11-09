"use client";

import { ActionForm } from "./ui/action-form";
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
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { checkPhotoFile, preparePhoto } from "../lib/images";
import { Status } from "./ui";
import { buttonClass } from "./ui/button";
import { ACTIONS, FIELD, LABEL } from "./ui/form";
import { Section } from "./ui/record";
import { Result } from "./ui/result";
import { SET_INPUT, SET_SELECT, SET_TEXTAREA } from "./ui/settings";
import { CheckLine, FORM_ROW, ItemRow, LINK, LIST, NOTE, SUB_HEAD } from "./ui/tenancy";

export { Result };

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
    <Section id="mi-h" title="Move-in checklist" hint={active ? "Completed" : `${view.missing.length} item(s) left`}>
      <ul className={LIST}>
        <CheckLine done={!!view.ejariNo}>Ejari {view.ejariNo ?? "number missing"}</CheckLine>
        {checks.map((i) => (
          <CheckLine
            key={i.id}
            done={i.done}
            action={
              canAct && !active ? (
                <ActionForm state={tickState} action={tick}>
                  <input type="hidden" name="leaseId" value={leaseId} />
                  <input type="hidden" name="item" value={i.id} />
                  <input type="hidden" name="done" value={String(!i.done)} />
                  <button
                    type="submit"
                    className={buttonClass(i.done ? "primary" : "ghost", "sm")}
                    disabled={ticking}
                    aria-pressed={i.done}
                  >
                    {i.done ? "✓" : "Tick"}
                  </button>
                </ActionForm>
              ) : undefined
            }
          >
            {i.label}
          </CheckLine>
        ))}
      </ul>
      <h3 className={`${SUB_HEAD} mt-1`}>Condition photos</h3>
      <ul className={LIST}>
        {rooms.map((r) => {
          const shots = view.photos.filter((p) => p.room === r.label && p.kind === "condition_photo");
          const tenantShots = view.photos.filter((p) => p.room === r.label && p.kind === "tenant_condition_photo");
          return (
            <ItemRow
              key={r.id}
              title={
                <span className="inline-flex items-center gap-1.5">
                  {!r.done && <IconWarning size={14} className="text-warning" aria-label="No photo yet" />}
                  {r.label}
                </span>
              }
              meta={
                <>
                  {shots.map((p, n) => (
                    <a
                      key={p.id}
                      className={LINK}
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
                      className={LINK}
                      href={`/api/leases/${leaseId}/photos/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      tenant&apos;s photo {n + 1}
                    </a>
                  ))}
                  {!shots.length && !tenantShots.length && !(upload?.room === r.label && upload.error) && (
                    <span>no photo yet</span>
                  )}
                  {upload?.room === r.label && upload.error ? <span>{upload.error}</span> : null}
                </>
              }
              side={
                canAct && !active ? (
                  <label className={`${buttonClass("ghost", "sm")} cursor-pointer`}>
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
                ) : undefined
              }
            />
          );
        })}
      </ul>
      {canAct && !active && (
        <ActionForm state={doneState} action={complete} className="grid gap-2">
          <input type="hidden" name="leaseId" value={leaseId} />
          <div>
            <button
              type="submit"
              className={buttonClass("primary", "sm")}
              disabled={completing || view.missing.length > 0}
            >
              Complete move-in
            </button>
          </div>
          {view.missing.length > 0 && <p className={NOTE}>Still missing: {view.missing.join("; ")}.</p>}
        </ActionForm>
      )}
      <Result s={tickState} />
      <Result s={doneState} />
    </Section>
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
    <Section id="pay-h" title="Rent payments" hint="Finance confirms every payment">
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted">Instalments are created when the tenant moves in.</p>
      ) : (
        <ul className={LIST}>
          {rows.map((p) => {
            const isOpen = p.status === "scheduled" || p.status === "overdue" || p.status === "bounced";
            // Assumed paid when the lease was imported: finance checks it and can still record a bounce.
            const assumed = p.status === "paid" && p.paidRef === "assumed paid at import";
            return (
              <ItemRow
                key={p.id}
                title={
                  <>
                    {p.seq}. {aedShort(p.amountFils)} · due {shortDate(p.dueOn)}
                  </>
                }
                meta={
                  <>
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
                  </>
                }
                side={
                  <>
                    <Status value={p.status} />
                    {(isOpen || assumed) && canRecord && (
                      <button
                        type="button"
                        className={buttonClass("ghost", "sm")}
                        aria-expanded={open === p.id}
                        onClick={() => setOpen(open === p.id ? null : p.id)}
                      >
                        Record
                      </button>
                    )}
                  </>
                }
              >
                {open === p.id && (
                  <div className="grid gap-2">
                    {isOpen && (
                      <ActionForm state={recState} action={record} className={FORM_ROW}>
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
                          className={`${SET_INPUT} w-auto!`}
                        />
                        <input
                          name="ref"
                          placeholder="Reference"
                          required
                          maxLength={120}
                          aria-label="Reference"
                          className={`${SET_INPUT} w-auto!`}
                        />
                        <button type="submit" className={buttonClass("primary", "sm")} disabled={recording}>
                          Paid
                        </button>
                      </ActionForm>
                    )}
                    {p.method === "cheque" && p.status !== "bounced" && p.dueOn <= today && (
                      <ActionForm state={recState} action={record}>
                        <input type="hidden" name="leaseId" value={leaseId} />
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="outcome" value="bounced" />
                        <button type="submit" className={buttonClass("ghost", "sm")} disabled={recording}>
                          Cheque bounced
                        </button>
                      </ActionForm>
                    )}
                  </div>
                )}
                {(p.status === "overdue" || p.status === "bounced") && !p.formalReminderSentOn && canPropose && (
                  <ActionForm state={formalState} action={formal}>
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button type="submit" className={buttonClass("ghost", "sm")} disabled={proposing}>
                      Propose formal reminder
                    </button>
                  </ActionForm>
                )}
              </ItemRow>
            );
          })}
        </ul>
      )}
      <Result s={recState} />
      <Result s={formalState} />
    </Section>
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
    <Section
      id="cmp-h"
      title="Issues and maintenance"
      action={
        canLog ? (
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            aria-expanded={showLog}
            onClick={() => setShowLog(!showLog)}
          >
            Log an issue
          </button>
        ) : undefined
      }
    >
      {showLog && (
        <ActionForm state={logState} action={log} className="grid gap-3 rounded-xl border border-line p-3.5">
          <input type="hidden" name="leaseId" value={leaseId} />
          <label className={FIELD}>
            <span className={LABEL}>What the tenant reported</span>
            <textarea name="description" rows={3} maxLength={2000} required className={SET_TEXTAREA} />
          </label>
          <label className={FIELD}>
            <span className={LABEL}>Room</span>
            <input name="room" maxLength={60} className={SET_INPUT} />
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="atRisk" className="size-4 accent-primary" /> Someone is at risk
          </label>
          <div>
            <button type="submit" className={buttonClass("primary", "sm")} disabled={logging}>
              Log it
            </button>
          </div>
          <Result s={logState} />
        </ActionForm>
      )}
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted">No issues reported.</p>
      ) : (
        <ul className={LIST}>
          {rows.map((c) => (
            <ItemRow
              key={c.id}
              dir="auto"
              title={
                <>
                  {c.atRisk && <IconWarning size={14} className="mr-1 inline text-danger" aria-label="At risk" />}
                  {c.text.slice(0, 160)}
                </>
              }
              meta={
                <>
                  <span className="font-mono">{c.ref}</span>
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
                </>
              }
              side={<Status value={c.status} />}
            >
              {canAct && c.status === "review" && (
                <div className={ACTIONS}>
                  <ActionForm state={resState} action={resolve} className={FORM_ROW}>
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="complaintId" value={c.id} />
                    <input type="hidden" name="action" value="ticket" />
                    <select
                      name="category"
                      aria-label="Category"
                      defaultValue="building"
                      className={`${SET_SELECT} w-auto!`}
                    >
                      {CATEGORIES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                    <select name="urgency" aria-label="Urgency" defaultValue="1" className={`${SET_SELECT} w-auto!`}>
                      {URGENCY.map((u, i) => (
                        <option key={u} value={i}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={buttonClass("primary", "sm")} disabled={resolving}>
                      Open ticket
                    </button>
                  </ActionForm>
                  <ActionForm state={resState} action={resolve} className={FORM_ROW}>
                    <input type="hidden" name="leaseId" value={leaseId} />
                    <input type="hidden" name="complaintId" value={c.id} />
                    <input type="hidden" name="action" value="close" />
                    <input
                      name="reason"
                      placeholder="Why it's closed"
                      required
                      minLength={3}
                      aria-label="Reason"
                      className={`${SET_INPUT} w-auto!`}
                    />
                    <button type="submit" className={buttonClass("ghost", "sm")} disabled={resolving}>
                      Close
                    </button>
                  </ActionForm>
                </div>
              )}
            </ItemRow>
          ))}
        </ul>
      )}
      <Result s={resState} />
    </Section>
  );
}
