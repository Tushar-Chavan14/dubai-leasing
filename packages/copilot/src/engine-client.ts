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
  /^\/api\/available-units(\?(bedrooms=[0-4]|community=[^&]*|maxRentFils=\d{1,12}|code=[A-Za-z0-9-]{2,40})(&(bedrooms=[0-4]|community=[^&]*|maxRentFils=\d{1,12}|code=[A-Za-z0-9-]{2,40}))*)?$/,
];

/** The only write the copilot can make: store a proposal. Confirm and cancel are never reachable. */
const PROPOSE_ALLOWED = [/^\/api\/copilot\/proposals$/];

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
