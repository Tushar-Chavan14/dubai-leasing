"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { deleteView, saveView, type ViewState } from "./actions";

export interface SavedViewItem {
  id: string;
  name: string;
}

/** Stage filter chips, the user's saved views, and a "Save view" form for the current filter. */
export function SavedViews({
  views,
  activeView,
  filter,
  canSave,
  clearHref,
  clearStageHref,
  stage,
}: {
  views: SavedViewItem[];
  activeView: string | undefined;
  filter: { stage: string; q: string; mine: boolean };
  canSave: boolean;
  clearHref: string;
  clearStageHref: string;
  stage: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ViewState, FormData>(saveView, {});
  return (
    <div className="wk-views">
      <ul className="wk-chips" aria-label="Views">
        <li>
          <Link href={clearHref} className="wk-chip" aria-current={!activeView && !stage ? "true" : undefined}>
            All
          </Link>
        </li>
        <li>
          <Link
            href="/work?view=waiting"
            className="wk-chip"
            aria-current={activeView === "waiting" ? "true" : undefined}
          >
            Waiting for me
          </Link>
        </li>
        {views.map((v) => (
          <li key={v.id} className="wk-chip-wrap">
            <Link
              href={`/work?view=${v.id}`}
              className="wk-chip"
              aria-current={activeView === v.id ? "true" : undefined}
            >
              {v.name}
            </Link>
            {activeView === v.id && (
              <form action={deleteView}>
                <input type="hidden" name="id" value={v.id} />
                <button type="submit" className="wk-chip-x" aria-label={`Delete the view ${v.name}`}>
                  Delete
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {stage && (
        <p className="wk-filter">
          Stage: {stage}{" "}
          <Link href={clearStageHref} className="link">
            Clear
          </Link>
        </p>
      )}
      {canSave && !open && (
        <button type="button" className="cp-link" onClick={() => setOpen(true)}>
          Save view
        </button>
      )}
      {open && (
        <form action={action} className="wk-save">
          <input type="hidden" name="stage" value={filter.stage} />
          <input type="hidden" name="q" value={filter.q} />
          <input type="hidden" name="mine" value={filter.mine ? "1" : "0"} />
          <label htmlFor="wk-view-name" className="sr-only">
            View name
          </label>
          <input id="wk-view-name" name="name" maxLength={40} placeholder="Name this view" autoFocus required />
          <button type="submit" className="btn small primary" disabled={pending}>
            Save
          </button>
          <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
          {state.error && (
            <p className="wk-err" role="alert">
              {state.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
