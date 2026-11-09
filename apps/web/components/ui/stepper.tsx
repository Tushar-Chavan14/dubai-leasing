/** The record's stage tracker: one bar per stage, finished bars solid, the current one tinted and named in bold. */
export function RecordStepper({ stages, current }: { stages: readonly string[]; current: string }) {
  const at = stages.indexOf(current);
  return (
    <ol aria-label="Stage" className="m-0 flex list-none gap-1 p-0">
      {stages.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "todo";
        return (
          <li
            key={s}
            {...(state === "now" ? { "aria-current": "step" as const } : {})}
            className={`grid min-w-0 flex-1 gap-1.5 text-[11.5px] ${state === "now" ? "font-semibold text-ink" : "text-muted"}`}
          >
            <span
              aria-hidden
              className={`h-1 rounded ${state === "done" ? "bg-ink" : state === "now" ? "bg-accent outline outline-1 -outline-offset-1 outline-ink/20" : "bg-line"}`}
            />
            <span className="truncate">
              {s}
              <span className="sr-only">
                {state === "done" ? " (done)" : state === "now" ? " (current)" : " (to do)"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
