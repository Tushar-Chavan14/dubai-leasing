/**
 * The only way the copilot reaches the engine (C36, S68). Two methods and two allowlists:
 *   get      a fixed set of read routes (each does its own role filtering);
 *   propose  POST /api/copilot/proposals and POST /api/copilot/drafts, nothing else.
 * The confirm and cancel routes, every decide, send, sign, submit, clear and settings route are not on a list, so a tool
 * cannot reach them whatever a model or a document says. A test fails on any extra path.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const QUERY = "(?:\\?[A-Za-z0-9_=&.%:~-]{0,300})?";
const route = (p: string) => new RegExp(`^${p}${QUERY}$`);

export const GET_ALLOWLIST: readonly RegExp[] = Object.freeze([
  route("/api/deals"),
  route(`/api/deals/${UUID}`),
  route(`/api/deals/${UUID}/events`),
  route(`/api/deals/${UUID}/payments`),
  route(`/api/deals/${UUID}/settlement`),
  route(`/api/deals/${UUID}/signing`),
  route(`/api/deals/${UUID}/noc-status`),
  route("/api/approvals"),
  route("/api/tasks"),
  route("/api/listings"),
  route(`/api/listings/${UUID}`),
  route("/api/templates"),
  route(`/api/templates/${UUID}`),
  route("/api/copilot/rulebook"),
  route("/api/compliance/cases"),
  route(`/api/compliance/cases/${UUID}`),
]);

export const PROPOSE_ALLOWLIST: readonly string[] = Object.freeze(["/api/copilot/proposals", "/api/copilot/drafts"]);

export interface EngineResponse {
  status: number;
  body: unknown;
}
export type Transport = (req: {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}) => Promise<EngineResponse>;

/** What a tool sees of the engine. */
export interface EngineClient {
  get(path: string): Promise<unknown>;
  propose(path: string, body: Record<string, unknown>): Promise<unknown>;
}

/** A refusal from the engine, in words a model can pass on (never the engine's own message for a 403). */
export class EngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

const refusalText = (r: EngineResponse): string => {
  if (r.status === 403) return "your role can't use this";
  if (r.status === 404) return "not found";
  if (r.status === 410) return "this has expired";
  const b = r.body as { error?: unknown } | null;
  const m = typeof b?.error === "string" ? b.error.slice(0, 200) : "";
  return m || `the engine answered ${r.status}`;
};

export function engineClient(transport: Transport): EngineClient {
  return {
    async get(path) {
      if (!GET_ALLOWLIST.some((re) => re.test(path)))
        throw new EngineError(0, "that route is not available to the copilot");
      const r = await transport({ method: "GET", path });
      if (r.status < 200 || r.status > 299) throw new EngineError(r.status, refusalText(r));
      return r.body;
    },
    async propose(path, body) {
      if (!PROPOSE_ALLOWLIST.includes(path)) throw new EngineError(0, "that route is not available to the copilot");
      const r = await transport({ method: "POST", path, body });
      if (r.status < 200 || r.status > 299) throw new EngineError(r.status, refusalText(r));
      return r.body;
    },
  };
}
