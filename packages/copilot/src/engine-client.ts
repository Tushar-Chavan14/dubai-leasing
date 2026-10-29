import { type EngineClient, EngineError } from "./types.ts";

/** Anything that answers a `Request` like a Hono app: `app.request(path, init)`. */
export interface RequestHandler {
  request(path: string, init: RequestInit): Response | Promise<Response>;
}

async function parse<T>(res: Response, path: string): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // not JSON
  }
  throw new EngineError(res.status, `${path.split("?")[0]} failed: ${message}`);
}

const ID = "[0-9a-fA-F-]{36}";
/** One query parameter of `/api/available-units` and of `/api/copilot/records`. */
const AU =
  "bedrooms=[0-4]|community=[^&]*|maxRentFils=\\d{1,12}|code=[A-Za-z0-9-]{2,40}|company=[^&]*|category=(?:residential|commercial|retail|all)|sizeBand=(?:small|medium|large)";
const RK = `stage=[A-Za-z]+|q=[^&]*|company=[^&]*|category=(?:residential|commercial|retail)|mine=[01]|id=${ID}|limit=\\d{1,2}`;
/**
 * The read routes copilot tools may call, and nothing else: no documents, no portal, no demo
 * controls, no write routes (which the client couldn't call anyway: it only sends GET).
 */
const ALLOWED = [
  /^\/api\/search\?q=[^&]*$/,
  new RegExp(`^/api/leases/${ID}$`),
  new RegExp(`^/api/leases/${ID}/renewal-cap$`),
  /^\/api\/approvals\?status=(pending|decided|all)$/,
  /^\/api\/deadlines\?days=\d{1,3}$/,
  /^\/api\/rules$/,
  /^\/api\/rules\/[A-Za-z0-9.%-]+(\?leaseEndOn=\d{4}-\d{2}-\d{2})?$/,
  new RegExp(`^/api/helper-runs/${ID}$`),
  new RegExp(`^/api/leases/${ID}/payments$`),
  new RegExp(`^/api/leases/${ID}/complaints$`),
  new RegExp(`^/api/leases/${ID}/case-pack$`),
  new RegExp(`^/api/available-units(\\?(${AU})(&(${AU}))*)?$`),
  /^\/api\/copilot\/pipeline$/,
  /^\/api\/copilot\/companies$/,
  /^\/api\/copilot\/contract-status\?ref=[^&]{2,200}$/,
  new RegExp(`^/api/copilot/records(\\?(${RK})(&(${RK}))*)?$`),
  /^\/api\/records\/(application|lease)\/[0-9a-fA-F-]{36}\/log$/,
  // D42: tasks, enquiry conversations, one unit with its price limits, and free viewing slots.
  /^\/api\/tasks\?status=(open|all)$/,
  /^\/api\/conversations$/,
  new RegExp(`^/api/conversations/${ID}$`),
  /^\/api\/copilot\/unit\?ref=[^&]{2,60}$/,
  new RegExp(`^/api/copilot/viewing-slots\\?(unit=[^&]{2,60}|applicationId=${ID})$`),
];

/** The only write the copilot can make: store a proposal. Confirm and cancel are never reachable. */
const PROPOSE_ALLOWED = [/^\/api\/copilot\/proposals$/, /^\/api\/copilot\/drafts$/];

function checkProposePath(path: string): string {
  if (!PROPOSE_ALLOWED.some((r) => r.test(path))) throw new EngineError(400, "invalid engine path");
  return path;
}

function checkPath(path: string): string {
  if (path.includes("..") || !ALLOWED.some((r) => r.test(path))) {
    throw new EngineError(400, "invalid engine path");
  }
  return path;
}

/** For tests: the read allowlist as the clients apply it. */
export const checkPathForTest = checkPath;

/** Calls the engine's own API in-process, as the user (the engine hosts the copilot). */
export function inProcessClient(
  app: RequestHandler,
  sessionToken: string,
  opts: { threadId?: string } = {},
): EngineClient {
  const auth = { authorization: `Bearer ${sessionToken}` };
  return {
    async get<T>(path: string) {
      const res = await app.request(checkPath(path), { method: "GET", headers: auth });
      return parse<T>(res, path);
    },
    async propose<T>(path: string, body: unknown) {
      const res = await app.request(checkProposePath(path), {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          ...(opts.threadId ? { "x-copilot-thread": opts.threadId } : {}),
        },
        body: JSON.stringify(body),
      });
      return parse<T>(res, path);
    },
  };
}

/** Calls a running engine over HTTP, as the user (evals, and the MCP server later). */
export function httpClient(baseUrl: string, sessionToken: string, opts: { threadId?: string } = {}): EngineClient {
  const auth = { authorization: `Bearer ${sessionToken}` };
  return {
    async get<T>(path: string) {
      const res = await fetch(new URL(checkPath(path), baseUrl), { method: "GET", headers: auth });
      return parse<T>(res, path);
    },
    async propose<T>(path: string, body: unknown) {
      const res = await fetch(new URL(checkProposePath(path), baseUrl), {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/json",
          ...(opts.threadId ? { "x-copilot-thread": opts.threadId } : {}),
        },
        body: JSON.stringify(body),
      });
      return parse<T>(res, path);
    },
  };
}
