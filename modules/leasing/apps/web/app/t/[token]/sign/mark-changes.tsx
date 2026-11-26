"use client";

import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { type ReactNode, useActionState, useEffect, useReducer, useState } from "react";
import { Banner } from "@platform/ui/form";
import { Done, Section, SMALL_GHOST } from "../../../../components/ui/portal";
import {
  MARK_REMINDER,
  type Mark,
  type MarksAction,
  marksKey,
  marksReducer,
  parseStoredMarks,
  sendLabel,
} from "../../../../lib/mark-changes";
import { type PortalState, requestChangeMarks } from "../actions";
import { ContractViewer } from "./contract-viewer";

function ChangesPanel({
  token,
  marks,
  pending,
  error,
  action,
  onEdit,
  onRemove,
}: {
  token: string;
  marks: Mark[];
  pending: boolean;
  error?: string | undefined;
  action: (fd: FormData) => void;
  onEdit: (m: Mark) => void;
  onRemove: (m: Mark) => void;
}) {
  return (
    <form
      action={action}
      aria-label="Your changes"
      className="grid gap-3 rounded-xl border border-line bg-page p-3.5 text-[15px] text-ink"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="marks" value={JSON.stringify(marks)} />
      <h3 className="m-0 text-sm font-semibold">Your changes ({marks.length})</h3>
      {marks.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">
          Select the words you want changed on the contract pages, then say what you would like instead.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0">
          {marks.map((m) => (
            <li key={m.id} className="grid gap-1 border-l-[3px] border-[#d4a000] py-1 pl-2.5">
              <span className="text-xs text-muted">
                {m.n}
                {m.label ? ` · ${m.label}` : ` · page ${m.page}`}
              </span>
              <span className="line-clamp-2 text-xs italic text-muted">&ldquo;{m.quote}&rdquo;</span>
              <span className="whitespace-pre-wrap text-[14px]">{m.note}</span>
              <span className="flex gap-3 text-[13px]">
                <button
                  type="button"
                  aria-label={`Edit change ${m.n}`}
                  onClick={() => onEdit(m)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-ink underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Remove change ${m.n}`}
                  onClick={() => onRemove(m)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-ink underline"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-xs text-muted">{MARK_REMINDER}</p>
      {error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </Banner>
      )}
      <button type="submit" className={SMALL_GHOST} disabled={pending || marks.length === 0}>
        {pending ? "Sending…" : sendLabel(marks.length)}
      </button>
      <p className="m-0 text-xs text-muted">Signing pauses for both parties until the leasing team answers.</p>
    </form>
  );
}

/**
 * Signing page: the signer marks words on the contract pages, adds a note to each, and sends them all as one change
 * request. Unsent marks are kept in localStorage per link. `fallback` (the old request form) is shown when a page has
 * no text layer to select from.
 */
export function MarkChanges({ token, fallback }: { token: string; fallback: ReactNode }) {
  const [marks, rawDispatch] = useReducer(marksReducer, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [textless, setTextless] = useState(false);
  const [state, action, pending] = useActionState<PortalState, FormData>(async (prev, fd) => {
    const r = await requestChangeMarks(prev, fd);
    // Cleared as soon as the request is in, not in an effect that may not run after revalidation.
    if (r.ref) {
      try {
        localStorage.removeItem(marksKey(token));
      } catch {
        /* ignore */
      }
    }
    return r;
  }, {});

  // Every change is saved as it happens, so unsent marks survive a reload.
  const dispatch = (a: MarksAction) => {
    const next = marksReducer(marks, a);
    rawDispatch(a);
    try {
      if (next.length) localStorage.setItem(marksKey(token), JSON.stringify(next));
      else localStorage.removeItem(marksKey(token));
    } catch {
      /* storage blocked: marks live in memory only */
    }
  };

  useEffect(() => {
    try {
      const saved = parseStoredMarks(localStorage.getItem(marksKey(token)));
      if (saved.length) rawDispatch({ type: "load", marks: saved });
    } catch {
      /* storage blocked */
    }
  }, [token]);

  const sent = !!state.ref;
  useEffect(() => {
    if (!sent) return;
    rawDispatch({ type: "clear" });
    try {
      localStorage.removeItem(marksKey(token));
    } catch {
      /* ignore */
    }
  }, [sent, token]);

  if (sent) {
    return (
      <Done title="Request sent">
        <p className="m-0">
          Reference <span className="font-mono text-[13px]">{state.ref}</span>. Signing is paused for everyone while the
          leasing team reviews it. We&apos;ll email you their answer.
        </p>
      </Done>
    );
  }

  const edit = (m: Mark) => {
    setEditingId(m.id);
    // The mark may be on a page far from where the signer is reading.
    requestAnimationFrame(() =>
      document.querySelector(`[data-mark="${m.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };
  const panel = (
    <ChangesPanel
      token={token}
      marks={marks}
      pending={pending}
      error={state.error}
      action={action}
      onEdit={edit}
      onRemove={(m) => dispatch({ type: "remove", id: m.id })}
    />
  );
  const showPanel = !textless || marks.length > 0;

  return (
    <>
      <ContractViewer
        token={token}
        marking={{ marks, editingId, setEditingId, dispatch, onNoText: () => setTextless(true) }}
        side={showPanel ? panel : undefined}
      />
      {showPanel && (
        <Section title="Request a change">
          {marks.length === 0 && (
            <p className="m-0 text-[13px] text-muted">
              Open the contract, select the words you want changed and add a note. You can mark as many as you like and
              send them together.
            </p>
          )}
          {panel}
        </Section>
      )}
      {textless && marks.length === 0 && fallback}
    </>
  );
}
