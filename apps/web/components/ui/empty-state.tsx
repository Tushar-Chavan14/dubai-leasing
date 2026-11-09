import type { ReactNode } from "react";

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-raised px-6 py-10 text-center">
      <h3 className="m-0 font-sans text-base font-semibold text-ink">{title}</h3>
      {body ? <p className="m-0 max-w-md font-sans text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
