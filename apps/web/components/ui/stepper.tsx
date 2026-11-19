import { CheckIcon } from "@phosphor-icons/react/dist/ssr";

/**
 * The record's stage tracker: one numbered circle per stage joined by a line. Finished stages are green with a tick,
 * the current one is blue with a soft ring and its name in bold, later ones are hollow.
 * `labels` renames stages for display (the Ejari stage is Tawtheeq, Attestation, … outside Dubai).
 */
export function RecordStepper({
  stages,
  current,
  labels,
}: {
  stages: readonly string[];
  current: string;
  labels?: Partial<Record<string, string>>;
}) {
  const at = stages.indexOf(current);
  return (
    <ol aria-label="Stage" className="m-0 flex list-none items-start p-0">
      {stages.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "todo";
        return (
          <li
            key={s}
            {...(state === "now" ? { "aria-current": "step" as const } : {})}
            className="relative grid min-w-0 flex-1 justify-items-center gap-1.5 text-center"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-[13px] right-[calc(50%+18px)] left-[calc(-50%+18px)] h-0.5 rounded ${
                  state === "todo" ? "bg-line" : "bg-success"
                }`}
              />
            )}
            <span
              aria-hidden
              className={`relative grid size-7 place-items-center rounded-full font-sans text-[12px] font-bold ${
                state === "done"
                  ? "bg-success text-page"
                  : state === "now"
                    ? "bg-primary text-on-primary ring-4 ring-primary/15"
                    : "border border-line bg-page text-muted"
              }`}
            >
              {state === "done" ? <CheckIcon size={14} weight="bold" /> : i + 1}
            </span>
            <span
              className={`w-full truncate px-0.5 text-[11.5px] ${state === "now" ? "font-semibold text-ink" : state === "done" ? "text-ink" : "text-muted"}`}
            >
              {labels?.[s] ?? s}
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
