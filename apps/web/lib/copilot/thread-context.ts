/** Same shape as `PageRef` in components/copilot/use-chat (kept here so this file stays free of JSX imports). */
type PageRef = { kind: "lease" | "unit" | "approval"; id: string };

/** The dock's current conversation. `id: null` is a new chat that has not been sent yet. */
export type DockThread = { id: string | null; context: PageRef | null };

const same = (a: PageRef | null, b: PageRef | undefined) => !!a && !!b && a.kind === b.kind && a.id === b.id;

/**
 * Whether the dock keeps its thread or starts a new one. The engine binds a thread to the record of
 * its first message, so a thread about lease A is never reused for lease B.
 */
export function nextThreadFor(
  current: DockThread,
  page: PageRef | undefined,
  reason: "navigate" | "ask" | "new",
): { action: "keep" | "new"; context: PageRef | null } {
  if (reason === "new") return { action: "new", context: page ?? null };
  if (reason === "navigate" || !page || same(current.context, page))
    return { action: "keep", context: current.context };
  return { action: "new", context: page };
}
