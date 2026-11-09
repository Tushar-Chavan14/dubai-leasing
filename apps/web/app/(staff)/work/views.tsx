"use client";

import { ActionForm } from "../../../components/ui/action-form";
import Link from "next/link";
import { useActionState, useState } from "react";
import { buttonClass } from "../../../components/ui/button";
import { INPUT } from "../../../components/ui/form";
import { deleteView, saveView, type ViewState } from "./actions";

export interface SavedViewItem {
  id: string;
  name: string;
}

const CHIP =
  "rounded-full border border-line px-2.5 py-1 font-sans text-xs text-ink no-underline hover:border-ink aria-[current=true]:border-transparent aria-[current=true]:bg-accent aria-[current=true]:text-on-accent! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The user's saved views as chips, the stage filter in use, and a "Save view" form for the current filter. */
export function SavedViews({
  views,
  activeView,
  filter,
  canSave,
  clearStageHref,
  stage,
  kind,
}: {
  /** Keeps the Workspace tab (applications or leases) when a view is picked. */
  kind?: "application" | "lease";
  views: SavedViewItem[];
  activeView: string | undefined;
  filter: { stage: string; q: string; mine: boolean };
  canSave: boolean;
  clearStageHref: string;
  stage: string | undefined;
}) {
  const kindQs = kind ? `&kind=${kind}` : "";
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ViewState, FormData>(saveView, {});
  if (views.length === 0 && !stage && !canSave) return null;
  return (
    <div className="grid gap-2">
      {views.length > 0 && (
        <ul aria-label="Saved views" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {views.map((v) => (
            <li key={v.id} className="flex items-center gap-1">
              <Link
                href={`/work?view=${v.id}${kindQs}`}
                className={CHIP}
                aria-current={activeView === v.id ? "true" : undefined}
              >
                {v.name}
              </Link>
              {activeView === v.id && (
                <form action={deleteView}>
                  <input type="hidden" name="id" value={v.id} />
                  <button
                    type="submit"
                    className="cursor-pointer border-0 bg-transparent p-0 font-sans text-xs text-muted underline"
                    aria-label={`Delete the view ${v.name}`}
                  >
                    Delete
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {stage && (
        <p className="m-0 text-xs text-muted">
          Stage: {stage}{" "}
          <Link href={clearStageHref} className="font-semibold text-ink! underline">
            Clear
          </Link>
        </p>
      )}
      {canSave && !open && (
        <button
          type="button"
          className="w-fit cursor-pointer border-0 bg-transparent p-0 font-sans text-xs font-semibold text-ink underline"
          onClick={() => setOpen(true)}
        >
          Save view
        </button>
      )}
      {open && (
        <ActionForm state={state} action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="stage" value={filter.stage} />
          <input type="hidden" name="q" value={filter.q} />
          <input type="hidden" name="mine" value={filter.mine ? "1" : "0"} />
          <label htmlFor="wk-view-name" className="sr-only">
            View name
          </label>
          <input
            id="wk-view-name"
            name="name"
            maxLength={40}
            placeholder="Name this view"
            autoFocus
            required
            className={`${INPUT} !w-auto min-w-0 flex-1`}
          />
          <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
            Save
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
            Cancel
          </button>
          {state.error && (
            <p className="m-0 w-full text-xs font-semibold text-danger" role="alert">
              {state.error}
            </p>
          )}
        </ActionForm>
      )}
    </div>
  );
}
