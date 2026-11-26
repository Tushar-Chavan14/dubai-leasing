"use client";

import { ActionForm } from "@platform/ui/action-form";
import { useActionState, useEffect, useState } from "react";
import {
  addApprovalNote,
  addTask,
  emailApplicant,
  emailTenant,
  markTaskDone,
  proposeVacateNotice,
  recordLandlordAnswer,
  type TaskActionState,
} from "../app/(staff)/tasks/actions";
import { Result } from "./tenancy-panels";
import { buttonClass } from "@platform/ui/button";
import { ACTIONS, FIELD, INPUT, LABEL } from "@platform/ui/form";
import { Modal } from "@platform/ui/modal";
import { PlusIcon } from "@phosphor-icons/react";

const LEASING = ["leasing_officer", "leasing_manager"];

const ANSWERS: [string, string][] = [
  ["renew", "Renew"],
  ["sale", "Selling the unit"],
  ["own_use", "Own use (or a first-degree relative)"],
  ["major_works", "Major works needing it empty"],
  ["demolition", "Demolition"],
  ["not_reached", "Couldn't reach the landlord"],
];

const GROUNDS: [string, string][] = ANSWERS.filter(([v]) => v !== "renew" && v !== "not_reached");

/**
 * The buttons on one open task: Done (the assignee's role or a leasing manager), or, for the
 * landlord question, the landlord's answer, followed by the 12-month notice form when a
 * repossession ground can still end this term.
 */
export function TaskActions({
  task,
  role,
  today,
}: {
  task: { id: string; kind: string; assigneeRole: string; entityKind: string; entityId: string };
  role: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [doneState, done, finishing] = useActionState<TaskActionState, FormData>(markTaskDone, {});
  const [answerState, answer, answering] = useActionState<TaskActionState, FormData>(recordLandlordAnswer, {});
  const leaseId = task.entityKind === "lease" ? task.entityId : "";

  if (task.kind === "landlord_intent") {
    if (!LEASING.includes(role)) return null;
    return (
      <div className="grid justify-items-start gap-2">
        {!open && !answerState.ok && (
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(true)}>
            Record the landlord&apos;s answer
          </button>
        )}
        {open && !answerState.ok && (
          <ActionForm state={answerState} action={answer} className="grid gap-3">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="leaseId" value={leaseId} />
            <label className={FIELD}>
              <span className={LABEL}>The landlord&apos;s plan for the end of the term</span>
              <select className={INPUT} name="answer" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {ANSWERS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className={FIELD}>
              <span className={LABEL}>
                Note <em className="font-normal not-italic">optional</em>
              </span>
              <textarea className={INPUT} name="note" rows={2} maxLength={2000} />
            </label>
            <div className={ACTIONS}>
              <button type="submit" className={buttonClass("primary", "sm")} disabled={answering}>
                Save
              </button>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </ActionForm>
        )}
        <Result s={answerState} />
        {answerState.vacate && (
          <VacateNoticeForm leaseId={answerState.vacate.leaseId} ground={answerState.vacate.ground} today={today} />
        )}
      </div>
    );
  }

  if (role !== task.assigneeRole && role !== "leasing_manager") return null;
  if (doneState.ok) return <Result s={doneState} />;
  return (
    <div className="grid justify-items-start gap-2">
      {!open ? (
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(true)}>
          Mark done
        </button>
      ) : (
        <ActionForm state={doneState} action={done} className={ACTIONS}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <input
            className={INPUT}
            name="note"
            maxLength={2000}
            placeholder="What was done (optional)"
            aria-label="Note"
          />
          <button type="submit" className={buttonClass("primary", "sm")} disabled={finishing}>
            Done
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </ActionForm>
      )}
      <Result s={doneState} />
    </div>
  );
}

/**
 * Records a 12-month repossession notice that a person already served by notary or registered
 * mail (never email). A leasing manager approves it; the rulebook check runs in the engine.
 */
export function VacateNoticeForm({ leaseId, ground, today }: { leaseId: string; ground?: string; today: string }) {
  const [state, submit, pending] = useActionState<TaskActionState, FormData>(proposeVacateNotice, {});
  if (state.ok) return <Result s={state} />;
  return (
    <ActionForm state={state} action={submit} className="grid gap-3">
      <strong>12-month repossession notice</strong>
      <p className="m-0 text-sm text-muted">
        Serve it by notary or registered mail first, then record it here for a leasing manager to approve. It is never
        sent by email.
      </p>
      <input type="hidden" name="leaseId" value={leaseId} />
      <label className={FIELD}>
        <span className={LABEL}>Ground</span>
        <select className={INPUT} name="ground" defaultValue={ground ?? ""} required>
          <option value="" disabled>
            Choose…
          </option>
          {GROUNDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className={FIELD}>
        <span className={LABEL}>Served on</span>
        <input className={INPUT} type="date" name="servedOn" max={today || undefined} required />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>Served by</span>
        <select className={INPUT} name="deliveryMethod" defaultValue="notary">
          <option value="notary">Notary public</option>
          <option value="registered_mail">Registered mail</option>
        </select>
      </label>
      <label className={FIELD}>
        <span className={LABEL}>
          Note <em className="font-normal not-italic">optional</em>
        </span>
        <textarea className={INPUT} name="note" rows={2} maxLength={2000} />
      </label>
      <div>
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
          Send for approval
        </button>
      </div>
      <Result s={state} />
    </ActionForm>
  );
}

/** Staff add a task to the lease (leasing roles). */
export function AddTaskForm({
  leaseId,
  today,
  startOpen = false,
  onClose,
}: {
  leaseId: string;
  today: string;
  /** Open straight away (inside the Add task dialog). */
  startOpen?: boolean;
  /** Called by Close instead of folding the form back to its button. */
  onClose?: () => void;
}) {
  const [state, submit, pending] = useActionState<TaskActionState, FormData>(addTask, {});
  const [open, setOpen] = useState(startOpen);
  if (!open)
    return (
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(true)}>
        Add task
      </button>
    );
  return (
    <ActionForm state={state} action={submit} className="grid gap-3">
      <input type="hidden" name="leaseId" value={leaseId} />
      <label className={FIELD}>
        <span className={LABEL}>Task</span>
        <input className={INPUT} name="title" minLength={3} maxLength={200} required />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>For</span>
        <select className={INPUT} name="assigneeRole" defaultValue="leasing_officer">
          <option value="leasing_officer">Leasing officer</option>
          <option value="leasing_manager">Leasing manager</option>
          <option value="finance">Finance</option>
        </select>
      </label>
      <label className={FIELD}>
        <span className={LABEL}>
          Due <em className="font-normal not-italic">optional</em>
        </span>
        <input className={INPUT} type="date" name="dueOn" min={today || undefined} />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>
          Note <em className="font-normal not-italic">optional</em>
        </span>
        <textarea className={INPUT} name="note" rows={2} maxLength={2000} />
      </label>
      <div className={ACTIONS}>
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
          Add
        </button>
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          onClick={() => (onClose ? onClose() : setOpen(false))}
        >
          Close
        </button>
      </div>
      <Result s={state} />
    </ActionForm>
  );
}

/**
 * The floating Add task button on a record: always in reach at the bottom of the pane, it opens the task form in a
 * dialog. Open tasks then show under Open work; with none, there is no Open work section at all.
 */
export function AddTaskFab({ leaseId, today }: { leaseId: string; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="pointer-events-none sticky bottom-4 z-10 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${buttonClass("primary", "md")} pointer-events-auto shadow-[0_12px_30px_-10px_rgb(11_16_32/0.55)]`}
        >
          <PlusIcon size={16} weight="bold" aria-hidden />
          Add task
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a task">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <b className="text-base font-semibold">Add a task</b>
          <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <AddTaskForm leaseId={leaseId} today={today} startOpen onClose={() => setOpen(false)} />
        </div>
      </Modal>
    </>
  );
}

/** Window event the record header fires to open the email form. */
export const COMPOSE_EMAIL = "leasing:compose-email";

/**
 * Email the tenant (D26): a person writes it, or edits a copilot draft, and sends it through the
 * mail adapter with the usual evidence. The copilot never sends.
 */
export function EmailTenantForm({
  leaseId,
  applicationId,
  tenantEmail,
  draft,
}: {
  leaseId?: string;
  /** An application: the email goes to its applicant (D42). */
  applicationId?: string;
  tenantEmail: string | null;
  draft?: { id: string; subject: string | null; body: string } | null;
}) {
  const who = applicationId ? "applicant" : "tenant";
  const [state, submit, pending] = useActionState<TaskActionState, FormData>(
    applicationId ? emailApplicant : emailTenant,
    {},
  );
  // Closed until the record header's "Email …" button (or a #email link) asks for it; a copilot draft opens it.
  const [open, setOpen] = useState(!!draft);
  useEffect(() => {
    const compose = () => setOpen(true);
    if (window.location.hash === "#email") compose();
    window.addEventListener(COMPOSE_EMAIL, compose);
    return () => window.removeEventListener(COMPOSE_EMAIL, compose);
  }, []);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={`Email the ${who}`}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="grid gap-0.5">
          <b className="text-base font-semibold">Email the {who}</b>
          {tenantEmail && <span className="text-[13px] text-muted">To {tenantEmail}</span>}
        </div>
        <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="grid gap-3 overflow-y-auto px-5 py-4">
        {!tenantEmail ? (
          <p className="m-0 text-sm text-muted">The {who} has no email address on file.</p>
        ) : state.ok ? (
          <>
            <Result s={state} />
            <div>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </>
        ) : (
          <ActionForm state={state} action={submit} className="grid gap-3">
            {applicationId ? (
              <input type="hidden" name="applicationId" value={applicationId} />
            ) : (
              <input type="hidden" name="leaseId" value={leaseId} />
            )}
            {draft && <input type="hidden" name="draftId" value={draft.id} />}
            {draft && (
              <p className="m-0 text-sm text-muted">
                Drafted by your copilot. Read it and change anything before you send it.
              </p>
            )}
            <p className="m-0 text-sm text-muted">
              {applicationId
                ? "The email is stored with the application as evidence."
                : "A link to their tenancy page is added below your message. Never use this for the 12-month repossession notice: that is served by notary or registered mail."}
            </p>
            <label className={FIELD}>
              <span className={LABEL}>Subject</span>
              <input
                className={INPUT}
                name="subject"
                minLength={3}
                maxLength={160}
                defaultValue={draft?.subject ?? ""}
                required
              />
            </label>
            <label className={FIELD}>
              <span className={LABEL}>Message</span>
              <textarea
                className={INPUT}
                name="body"
                rows={8}
                minLength={10}
                maxLength={5000}
                defaultValue={draft?.body ?? ""}
                required
              />
            </label>
            <div className={ACTIONS}>
              <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
                Send
              </button>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <Result s={state} />
          </ActionForm>
        )}
      </div>
    </Modal>
  );
}

/** Notes for the approver on an approval; a copilot draft can prefill one. */
export function ApprovalNoteForm({
  approvalId,
  draft,
}: {
  approvalId: string;
  draft?: { id: string; body: string } | null;
}) {
  const [state, submit, pending] = useActionState<TaskActionState, FormData>(addApprovalNote, {});
  return (
    <ActionForm state={state} action={submit} className="grid gap-3">
      <input type="hidden" name="approvalId" value={approvalId} />
      {draft && !state.ok && <input type="hidden" name="draftId" value={draft.id} />}
      {draft && !state.ok && (
        <p className="m-0 text-sm text-muted">
          Drafted by your copilot. Read it and change anything before you post it.
        </p>
      )}
      <label className={FIELD}>
        <span className={LABEL}>Add a note</span>
        <textarea
          className={INPUT}
          name="body"
          rows={3}
          minLength={2}
          maxLength={2000}
          defaultValue={state.ok ? "" : (draft?.body ?? "")}
          required
        />
      </label>
      <div>
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
          Post note
        </button>
      </div>
      <Result s={state} />
    </ActionForm>
  );
}
