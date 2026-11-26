"use client";

import { Button } from "@platform/ui/button";
import { FIELD, HINT, INPUT, LABEL } from "@platform/ui/form";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  type ActionResult,
  bookViewingAction,
  cancelViewingAction,
  leadSlotsAction,
  recordOutcomeAction,
  rescheduleViewingAction,
  setLeadStatusAction,
} from "../app/(staff)/leads/actions";
import { groupSlotsByDay } from "../lib/viewing-slots";

const MIN_REASON = 3;

/** Runs an action, shows its one fixed sentence on a refusal, and refreshes the page on success. */
function useRun() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setError(undefined);
        after?.();
        router.refresh();
      } else setError(r.error ?? "That couldn't be saved.");
    });
  return { busy, error, run, setError };
}

const Err = ({ text }: { text: string | undefined }) =>
  text ? (
    <p role="alert" className="m-0 text-sm text-danger">
      {text}
    </p>
  ) : null;

/**
 * A negative action (cancel, close). The button only opens the reason box; the second click, on Confirm, sends it
 * (UI rule). Cancel closes the box and forgets the text.
 */
export function ReasonAction({
  label,
  confirm,
  prompt,
  run,
}: {
  label: string;
  confirm: string;
  prompt: string;
  run: (reason: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const a = useRun();
  if (!open)
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="grid w-full max-w-md gap-2 rounded-xl border border-line bg-page p-3.5">
      <label className={FIELD}>
        <span className={LABEL}>{prompt}</span>
        <textarea
          className={INPUT}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className={HINT}>Kept in the activity with your name.</span>
      </label>
      <Err text={a.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={a.busy || reason.trim().length < MIN_REASON}
          onClick={() =>
            a.run(
              () => run(reason.trim()),
              () => (setOpen(false), setReason("")),
            )
          }
        >
          {a.busy ? "Saving…" : confirm}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={a.busy}
          onClick={() => (setOpen(false), setReason(""), a.setError(undefined))}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Free times grouped by day (Dubai), loaded when the box opens. */
function SlotBox({
  leadId,
  confirm,
  onPick,
  onClose,
}: {
  leadId: string;
  confirm: string;
  onPick: (slot: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [chosen, setChosen] = useState("");
  const a = useRun();
  const [asked, setAsked] = useState(false);
  if (!asked) {
    setAsked(true);
    void leadSlotsAction(leadId).then((r) => (r.slots ? setSlots(r.slots) : setLoadError(r.error)));
  }
  const days = groupSlotsByDay(slots ?? []);
  return (
    <div className="grid w-full max-w-md gap-3 rounded-xl border border-line bg-page p-3.5">
      {loadError && <Err text={loadError} />}
      {!slots && !loadError && <p className="m-0 text-sm text-muted">Loading free times…</p>}
      {slots && !days.length && <p className="m-0 text-sm text-muted">No free times for this home right now.</p>}
      <div className="grid max-h-56 gap-2.5 overflow-y-auto">
        {days.map((d) => (
          <div key={d.day} className="grid gap-1" role="group" aria-label={d.label}>
            <span className="text-[13px] font-semibold text-ink">{d.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {d.times.map((t) => (
                <label key={t.iso} className="relative">
                  <input
                    type="radio"
                    name={`slot-${leadId}`}
                    value={t.iso}
                    checked={chosen === t.iso}
                    onChange={() => setChosen(t.iso)}
                    className="peer sr-only"
                  />
                  <span className="inline-flex h-8 min-w-[4rem] cursor-pointer items-center justify-center rounded-lg border border-line bg-page px-2 text-sm tabular-nums peer-checked:border-ink peer-checked:bg-ink peer-checked:text-page peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
                    {t.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Err text={a.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={a.busy || !chosen}
          onClick={() => a.run(() => onPick(chosen), onClose)}
        >
          {a.busy ? "Saving…" : confirm}
        </Button>
        <Button variant="ghost" size="sm" disabled={a.busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** "Book a viewing" for a lead: opens the picker, confirms with the chosen time. */
export function BookViewingAction({ leadId, label = "Book a viewing" }: { leadId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <SlotBox
      leadId={leadId}
      confirm="Book this time"
      onPick={(s) => bookViewingAction(leadId, s)}
      onClose={() => setOpen(false)}
    />
  );
}

/** One status button (contacted, interested, not interested). Closing a lead is a ReasonAction. */
export function LeadStatusButton({
  leadId,
  status,
  label,
  variant = "ghost",
}: {
  leadId: string;
  status: "contacted" | "interested" | "not_interested";
  label: string;
  variant?: "primary" | "ghost";
}) {
  const a = useRun();
  return (
    <span className="grid gap-1">
      <Button
        variant={variant}
        size="sm"
        disabled={a.busy}
        onClick={() => a.run(() => setLeadStatusAction(leadId, status))}
      >
        {a.busy ? "Saving…" : label}
      </Button>
      <Err text={a.error} />
    </span>
  );
}

export function CloseLeadAction({ leadId }: { leadId: string }) {
  return (
    <ReasonAction
      label="Close this lead"
      confirm="Close the lead"
      prompt="Why is this lead being closed?"
      run={(reason) => setLeadStatusAction(leadId, "closed", reason)}
    />
  );
}

/** Attended or no-show, with an optional note. Only offered once the viewing has started. */
function OutcomeBox({ viewingId }: { viewingId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const a = useRun();
  if (!open)
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Record the outcome
      </Button>
    );
  return (
    <div className="grid w-full max-w-md gap-2 rounded-xl border border-line bg-page p-3.5">
      <label className={FIELD}>
        <span className={LABEL}>
          Note <span className="font-normal">(optional)</span>
        </span>
        <textarea className={INPUT} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <Err text={a.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={a.busy}
          onClick={() => a.run(() => recordOutcomeAction(viewingId, "attended", note))}
        >
          Attended
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={a.busy}
          onClick={() => a.run(() => recordOutcomeAction(viewingId, "no_show", note))}
        >
          No-show
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={a.busy}
          onClick={() => (setOpen(false), setNote(""), a.setError(undefined))}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * What a person can do with one viewing: record the outcome (only once it has started), reschedule, or cancel (reason
 * box first). A viewing that is over or cancelled shows none of them.
 */
export function ViewingActions({
  viewingId,
  leadId,
  needsOutcome,
  canChange,
}: {
  viewingId: string;
  leadId: string;
  needsOutcome: boolean;
  canChange: boolean;
}) {
  const [moving, setMoving] = useState(false);
  if (!canChange) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {needsOutcome && <OutcomeBox viewingId={viewingId} />}
      {moving ? (
        <SlotBox
          leadId={leadId}
          confirm="Move to this time"
          onPick={(s) => rescheduleViewingAction(viewingId, s)}
          onClose={() => setMoving(false)}
        />
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setMoving(true)}>
          Reschedule
        </Button>
      )}
      <ReasonAction
        label="Cancel viewing"
        confirm="Cancel the viewing"
        prompt="Why is it being cancelled?"
        run={(reason) => cancelViewingAction(viewingId, reason)}
      />
    </div>
  );
}
