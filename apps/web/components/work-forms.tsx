"use client";

import { useActionState, useState } from "react";
import {
  addApprovalNote,
  addTask,
  emailTenant,
  markTaskDone,
  proposeVacateNotice,
  recordLandlordAnswer,
  type TaskActionState,
} from "../app/(staff)/tasks/actions";
import { Result } from "./tenancy-panels";

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
      <div className="task-actions">
        {!open && !answerState.ok && (
          <button type="button" className="btn small" onClick={() => setOpen(true)}>
            Record the landlord&apos;s answer
          </button>
        )}
        {open && !answerState.ok && (
          <form action={answer} className="stack">
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="leaseId" value={leaseId} />
            <label className="field">
              <span className="field-label">The landlord&apos;s plan for the end of the term</span>
              <select name="answer" required defaultValue="">
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
            <label className="field">
              <span className="field-label">
                Note <em>optional</em>
              </span>
              <textarea name="note" rows={2} maxLength={2000} />
            </label>
            <div className="btn-row">
              <button type="submit" className="btn primary small" disabled={answering}>
                Save
              </button>
              <button type="button" className="btn small" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
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
    <div className="task-actions">
      {!open ? (
        <button type="button" className="btn small" onClick={() => setOpen(true)}>
          Mark done
        </button>
      ) : (
        <form action={done} className="btn-row">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="leaseId" value={leaseId} />
          <input name="note" maxLength={2000} placeholder="What was done (optional)" aria-label="Note" />
          <button type="submit" className="btn primary small" disabled={finishing}>
            Done
          </button>
          <button type="button" className="btn small" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
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
    <form action={submit} className="stack vacate-form">
      <strong>12-month repossession notice</strong>
      <p className="muted" style={{ margin: 0 }}>
        Serve it by notary or registered mail first, then record it here for a leasing manager to approve. It is never
        sent by email.
      </p>
      <input type="hidden" name="leaseId" value={leaseId} />
      <label className="field">
        <span className="field-label">Ground</span>
        <select name="ground" defaultValue={ground ?? ""} required>
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
      <label className="field">
        <span className="field-label">Served on</span>
        <input type="date" name="servedOn" max={today || undefined} required />
      </label>
      <label className="field">
        <span className="field-label">Served by</span>
        <select name="deliveryMethod" defaultValue="notary">
          <option value="notary">Notary public</option>
          <option value="registered_mail">Registered mail</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">
          Note <em>optional</em>
        </span>
        <textarea name="note" rows={2} maxLength={2000} />
      </label>
      <div>
        <button type="submit" className="btn primary small" disabled={pending}>
          Send for approval
        </button>
      </div>
      <Result s={state} />
    </form>
  );
}

/** Staff add a task to the lease (leasing roles). */
export function AddTaskForm({ leaseId, today }: { leaseId: string; today: string }) {
  const [state, submit, pending] = useActionState<TaskActionState, FormData>(addTask, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn small" onClick={() => setOpen(true)}>
        Add task
      </button>
    );
  return (
    <form action={submit} className="stack panel-pad">
      <input type="hidden" name="leaseId" value={leaseId} />
      <label className="field">
        <span className="field-label">Task</span>
        <input name="title" minLength={3} maxLength={200} required />
      </label>
      <label className="field">
        <span className="field-label">For</span>
        <select name="assigneeRole" defaultValue="leasing_officer">
          <option value="leasing_officer">Leasing officer</option>
          <option value="leasing_manager">Leasing manager</option>
          <option value="finance">Finance</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">
          Due <em>optional</em>
        </span>
        <input type="date" name="dueOn" min={today || undefined} />
      </label>
      <label className="field">
        <span className="field-label">
          Note <em>optional</em>
        </span>
        <textarea name="note" rows={2} maxLength={2000} />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn primary small" disabled={pending}>
          Add
        </button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <Result s={state} />
    </form>
  );
}

/**
 * Email the tenant (D26): a person writes it, or edits a copilot draft, and sends it through the
 * mail adapter with the usual evidence. The copilot never sends.
 */
export function EmailTenantForm({
  leaseId,
  tenantEmail,
  draft,
}: {
  leaseId: string;
  tenantEmail: string | null;
  draft?: { id: string; subject: string | null; body: string } | null;
}) {
  const [state, submit, pending] = useActionState<TaskActionState, FormData>(emailTenant, {});
  const [open, setOpen] = useState(!!draft);
  return (
    <section className="panel" id="email" aria-labelledby="email-h">
      <div className="panel-head">
        <h2 id="email-h">Email the tenant</h2>
        {!open && tenantEmail && (
          <button type="button" className="btn small" onClick={() => setOpen(true)}>
            Write
          </button>
        )}
      </div>
      {!tenantEmail ? (
        <p className="muted panel-pad">The tenant has no email address on file.</p>
      ) : state.ok ? (
        <div className="panel-pad">
          <Result s={state} />
        </div>
      ) : (
        open && (
          <form action={submit} className="stack panel-pad">
            <input type="hidden" name="leaseId" value={leaseId} />
            {draft && <input type="hidden" name="draftId" value={draft.id} />}
            {draft && (
              <p className="muted" style={{ margin: 0 }}>
                Drafted by your copilot. Read it and change anything before you send it.
              </p>
            )}
            <p className="muted" style={{ margin: 0 }}>
              To {tenantEmail}. A link to their tenancy page is added below your message. Never use this for the
              12-month repossession notice: that is served by notary or registered mail.
            </p>
            <label className="field">
              <span className="field-label">Subject</span>
              <input name="subject" minLength={3} maxLength={160} defaultValue={draft?.subject ?? ""} required />
            </label>
            <label className="field">
              <span className="field-label">Message</span>
              <textarea
                name="body"
                rows={8}
                minLength={10}
                maxLength={5000}
                defaultValue={draft?.body ?? ""}
                required
              />
            </label>
            <div className="btn-row">
              <button type="submit" className="btn primary small" disabled={pending}>
                Send
              </button>
              <button type="button" className="btn small" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <Result s={state} />
          </form>
        )
      )}
    </section>
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
    <form action={submit} className="stack">
      <input type="hidden" name="approvalId" value={approvalId} />
      {draft && !state.ok && <input type="hidden" name="draftId" value={draft.id} />}
      {draft && !state.ok && (
        <p className="muted" style={{ margin: 0 }}>
          Drafted by your copilot. Read it and change anything before you post it.
        </p>
      )}
      <label className="field">
        <span className="field-label">Add a note</span>
        <textarea
          name="body"
          rows={3}
          minLength={2}
          maxLength={2000}
          defaultValue={state.ok ? "" : (draft?.body ?? "")}
          required
        />
      </label>
      <div>
        <button type="submit" className="btn primary small" disabled={pending}>
          Post note
        </button>
      </div>
      <Result s={state} />
    </form>
  );
}
