"use client";

import { ActionForm } from "./ui/action-form";
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
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { checkPhotoFile, preparePhoto } from "../lib/images";
import { Status } from "./ui";
import { buttonClass } from "./ui/button";
import { FIELD, LABEL } from "./ui/form";
import { FactKey, FactList, FactVal, Section } from "./ui/record";
import { Result } from "./ui/result";
import { SET_INPUT, SET_SELECT } from "./ui/settings";
import { CheckLine, FORM_ROW, ItemRow, LINK, LIST, NOTE, SUB_HEAD } from "./ui/tenancy";

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
      <a key={id} className={LINK} href={`/api/leases/${leaseId}/photos/${id}`} target="_blank" rel="noreferrer">
        {what} {n + 1}
      </a>
    ));
  const s = view.statement;
  const payable = s && (s.status === "approved" || (s.status === "accepted" && !s.needsApproval));

  return (
    <Section
      id="mo-h"
      title="Move-out"
      hint={
        <>
          Moving out {longDate(view.moveOutOn)}
          {view.scheduledAt ? `, inspection ${dubaiTime(view.scheduledAt)}` : ", inspection not booked"}
        </>
      }
    >
      <ul className={LIST}>
        {view.items
          .filter((i) => i.kind === "check")
          .map((i) => (
            <CheckLine
              key={i.id}
              done={i.done}
              action={
                canAct && open ? (
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
        <CheckLine done={!!view.ejariCancelledOn}>
          Ejari{" "}
          {view.ejariNo
            ? view.ejariCancelledOn
              ? `${view.ejariNo} cancelled ${longDate(view.ejariCancelledOn)}`
              : `${view.ejariNo} active (cancelled automatically from the move-out date)`
            : "none on record"}
        </CheckLine>
      </ul>

      <h3 className={`${SUB_HEAD} mt-1`}>Rooms: move-in and move-out photos</h3>
      <ul className={LIST}>
        {view.rooms.map((r) => {
          const sug = view.suggestions.find((x) => x.room === r.room);
          return (
            <ItemRow
              key={r.room}
              title={
                <span className="inline-flex items-center gap-1.5">
                  {!r.moveOut.length && (
                    <IconWarning size={14} className="text-warning" aria-label="No move-out photo" />
                  )}
                  {r.room}
                </span>
              }
              meta={
                <>
                  {r.moveIn.length ? photoLinks(r.moveIn, "move-in") : <span>no move-in photo</span>}
                  {photoLinks(r.moveOut, "move-out")}
                  {upload?.room === r.room && upload.error ? <span>{upload.error}</span> : null}
                </>
              }
              side={
                canAct && open ? (
                  <label className={`${buttonClass("ghost", "sm")} cursor-pointer`}>
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
                ) : undefined
              }
            >
              {sug && (
                <div className="grid gap-1.5">
                  {sug.status === "pending" && <span className={NOTE}>Comparing…</span>}
                  {sug.status === "needs_human" && <span className={NOTE}>{sug.reasons.join(" ")}</span>}
                  {sug.status === "ok" && !sug.suggestions.length && (
                    <span className={NOTE}>No clear damage seen (suggestion only).</span>
                  )}
                  {sug.suggestions.map((x, n) => (
                    <ActionForm
                      state={addState}
                      key={n}
                      action={add}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <input type="hidden" name="leaseId" value={leaseId} />
                      <input type="hidden" name="room" value={r.room} />
                      <input type="hidden" name="itemId" value={x.itemId} />
                      <input type="hidden" name="quantity" value={x.quantity} />
                      <input type="hidden" name="fromSuggestion" value="true" />
                      <span className="text-sm">
                        Suggestion: {x.label} × {x.quantity}, “{x.description}” ({Math.round(x.confidence * 100)}%)
                      </span>
                      {canAct && view.findingsEditable && (
                        <button type="submit" className={buttonClass("ghost", "sm")} disabled={adding}>
                          Confirm
                        </button>
                      )}
                    </ActionForm>
                  ))}
                </div>
              )}
            </ItemRow>
          );
        })}
      </ul>
      {canAct && open && (
        <ActionForm state={cmpState} action={compare} className={FORM_ROW}>
          <input type="hidden" name="leaseId" value={leaseId} />
          <button type="submit" className={buttonClass("ghost", "sm")} disabled={comparing}>
            Compare with move-in photos
          </button>
          <span className={NOTE}>Local vision model; suggestions only. Normal wear and tear is not damage.</span>
        </ActionForm>
      )}

      <h3 className={`${SUB_HEAD} mt-1`}>Confirmed damage</h3>
      {view.findings.length ? (
        <ul className={LIST}>
          {view.findings.map((f) => {
            const price = view.priceList.find((p) => p.id === f.itemId)?.priceFils ?? f.otherAmountFils ?? 0;
            return (
              <ItemRow
                key={f.id}
                title={
                  <>
                    {f.room ? `${f.room}: ` : ""}
                    {f.itemId === "other" ? f.otherLabel : label(f.itemId)} × {f.quantity}
                  </>
                }
                meta={
                  <span>
                    {aedShort(price * f.quantity)}
                    {f.itemId === "other" ? " · not on the price list: finance approves" : ""}
                    {f.fromSuggestion ? " · from a suggestion" : ""}
                  </span>
                }
                side={
                  canAct && view.findingsEditable ? (
                    <ActionForm state={rmState} action={remove}>
                      <input type="hidden" name="leaseId" value={leaseId} />
                      <input type="hidden" name="findingId" value={f.id} />
                      <button type="submit" className={buttonClass("ghost", "sm")}>
                        Remove
                      </button>
                    </ActionForm>
                  ) : undefined
                }
              />
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted">None. The full deposit of {aedShort(view.depositFils)} is refunded.</p>
      )}
      {canAct && view.findingsEditable && (
        <ActionForm state={addState} action={add} className="grid gap-2">
          <input type="hidden" name="leaseId" value={leaseId} />
          <div className={FORM_ROW}>
            <select name="room" defaultValue="" aria-label="Room" className={`${SET_SELECT} w-auto!`}>
              <option value="">Whole unit</option>
              {view.rooms.map((r) => (
                <option key={r.room}>{r.room}</option>
              ))}
            </select>
            <select
              name="itemId"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              required
              aria-label="Price-list item"
              className={`${SET_SELECT} w-auto! max-w-full`}
            >
              <option value="">Price-list item…</option>
              {view.priceList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({aedShort(p.priceFils)} per {p.unit})
                </option>
              ))}
              <option value="other">Other (finance approves)</option>
            </select>
            <input
              name="quantity"
              type="number"
              min={1}
              max={999}
              defaultValue={1}
              aria-label="Quantity"
              className={`${SET_INPUT} w-[76px]!`}
            />
          </div>
          {item === "other" && (
            <div className={FORM_ROW}>
              <input
                name="otherLabel"
                placeholder="What is it?"
                maxLength={120}
                required
                aria-label="What is it?"
                className={`${SET_INPUT} w-auto!`}
              />
              <input
                name="otherAed"
                type="number"
                min={1}
                step="0.01"
                placeholder="AED"
                required
                aria-label="Amount in AED"
                className={`${SET_INPUT} w-[110px]!`}
              />
            </div>
          )}
          <div>
            <button type="submit" className={buttonClass("ghost", "sm")} disabled={adding}>
              Add damage item
            </button>
          </div>
        </ActionForm>
      )}

      {canAct && open && (
        <ActionForm state={doneState} action={complete} className="grid gap-2">
          <input type="hidden" name="leaseId" value={leaseId} />
          <div>
            <button
              type="submit"
              className={buttonClass("primary", "sm")}
              disabled={completing || view.missing.length > 0}
            >
              Complete inspection and send the deposit statement
            </button>
          </div>
          {view.missing.length > 0 && <p className={NOTE}>Still missing: {view.missing.join("; ")}.</p>}
        </ActionForm>
      )}

      {s && (
        <div className="grid gap-3 rounded-xl border border-line p-3.5">
          <h3 className={`${SUB_HEAD} flex flex-wrap items-center gap-2`}>
            Deposit statement {s.revision} <Status value={s.status} />
          </h3>
          <FactList>
            <FactKey>Deposit</FactKey>
            <FactVal>{aedShort(s.depositFils)}</FactVal>
            <FactKey>Deductions</FactKey>
            <FactVal>{aedShort(s.deductionsFils)}</FactVal>
            <FactKey>Refund</FactKey>
            <FactVal>
              <b>{aedShort(s.refundFils)}</b>
              {s.needsApproval ? " · finance approval needed" : ""}
            </FactVal>
            {s.owedFils > 0 && (
              <>
                <FactKey>Beyond the deposit</FactKey>
                <FactVal>{aedShort(s.owedFils)} (a manager decides)</FactVal>
              </>
            )}
          </FactList>
          {s.documentId && (
            <a
              className={`${LINK} w-fit text-sm`}
              href={`/api/leases/${leaseId}/documents/${s.documentId}`}
              target="_blank"
              rel="noreferrer"
            >
              Statement PDF
            </a>
          )}
          {canAct && s.status === "superseded" && (
            <ActionForm state={reState} action={reissue}>
              <input type="hidden" name="leaseId" value={leaseId} />
              <button type="submit" className={buttonClass("ghost", "sm")} disabled={reissuing}>
                Reissue corrected statement
              </button>
            </ActionForm>
          )}
          {isFinance && payable && (
            <ActionForm state={acctState} action={showAccount} className="grid gap-2">
              <input type="hidden" name="leaseId" value={leaseId} />
              <div>
                <button type="submit" className={buttonClass("ghost", "sm")} disabled={showing}>
                  Show refund account
                </button>
              </div>
              <Result s={acctState} />
            </ActionForm>
          )}
          {isFinance && payable && (
            <ActionForm state={payState} action={pay} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="leaseId" value={leaseId} />
              <label className={FIELD}>
                <span className={LABEL}>Paid on</span>
                <input type="date" name="paidOn" max={today} defaultValue={today} required className={SET_INPUT} />
              </label>
              <label className={FIELD}>
                <span className={LABEL}>Bank reference</span>
                <input name="ref" maxLength={120} required className={SET_INPUT} />
              </label>
              <button type="submit" className={buttonClass("primary", "sm")} disabled={paying}>
                Record refund paid
              </button>
            </ActionForm>
          )}
          {s.paidOn && <p className={NOTE}>Refund paid {longDate(s.paidOn)}.</p>}
        </div>
      )}
      {[tickState, cmpState, addState, rmState, doneState, reState, payState].map((st, n) => (
        <Result key={n} s={st} />
      ))}
    </Section>
  );
}
