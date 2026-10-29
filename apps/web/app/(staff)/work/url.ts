/** The Workspace keeps its whole state in the URL, so links, reloads and the old redirects all work. */
export interface WorkQuery {
  view?: string | undefined;
  q?: string | undefined;
  stage?: string | undefined;
  kind?: "application" | "lease" | undefined;
  id?: string | undefined;
  entry?: string | undefined;
  pane?: "open" | "closed" | undefined;
  wide?: boolean | undefined;
  draft?: string | undefined;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function parseQuery(raw: Record<string, string | string[] | undefined>): WorkQuery & { approval?: string } {
  const kind = first(raw.kind);
  const pane = first(raw.pane);
  const id = first(raw.id);
  const approval = first(raw.approval);
  const view = first(raw.view);
  return {
    view: view === "waiting" || (view && UUID_RE.test(view)) ? view : undefined,
    q: first(raw.q)?.slice(0, 80),
    stage: first(raw.stage),
    kind: kind === "application" || kind === "lease" ? kind : undefined,
    id: id && UUID_RE.test(id) ? id : undefined,
    entry: first(raw.entry),
    pane: pane === "open" || pane === "closed" ? pane : undefined,
    wide: first(raw.wide) === "1",
    draft: first(raw.draft),
    ...(approval && UUID_RE.test(approval) ? { approval } : {}),
  };
}

/** Build a `/work` link from the current state plus changes. `undefined` in `change` clears a key. */
export function workHref(current: WorkQuery, change: Partial<Record<keyof WorkQuery, unknown>> = {}): string {
  const merged: Record<string, unknown> = { ...current, ...change };
  const p = new URLSearchParams();
  for (const k of ["view", "q", "stage", "kind", "id", "entry", "pane", "draft"] as const) {
    const v = merged[k];
    if (typeof v === "string" && v) p.set(k, v);
  }
  if (merged.wide) p.set("wide", "1");
  const qs = p.toString();
  return qs ? `/work?${qs}` : "/work";
}
