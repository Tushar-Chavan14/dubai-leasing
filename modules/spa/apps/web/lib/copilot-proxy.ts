/**
 * The browser's way to the copilot (C36, S68): the dock posts to this site's own `/copilot/...`, and this decides which
 * engine route that means. Only the chat, the thread and a proposal's confirm and cancel pass; the user's own session goes
 * with them (the route adds it). There is no path for a draft, a decision, a send or a setting.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function copilotTarget(method: string, path: string): string | null {
  if (method === "POST" && path === "/copilot/chat") return "/api/copilot/chat";
  if (method === "GET" && path === "/copilot/thread") return "/api/copilot/thread";
  const m = /^\/copilot\/proposals\/([^/]+)\/(confirm|cancel)$/.exec(path);
  if (method === "POST" && m && UUID.test(m[1]!)) return `/api/copilot/proposals/${m[1]}/${m[2]}`;
  return null;
}
