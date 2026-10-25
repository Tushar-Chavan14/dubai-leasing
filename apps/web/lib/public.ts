import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { ENGINE_URL } from "./engine";

/**
 * Server-side only. The public site never lets the browser call the engine: the web server relays with
 * `CHANNEL_SECRET` (as the Telegram bot does) and sets the client address itself.
 */
export const VISITOR_COOKIE = "leasing_visitor";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export interface PublicResult<T> {
  ok: boolean;
  status: number;
  data: T;
  error?: { error?: string; code?: string };
}

/** The browser address our own proxy reports: `x-real-ip`, else the rightmost `x-forwarded-for` hop (earlier hops are client-supplied). */
export async function clientAddress(): Promise<string | null> {
  const h = await headers();
  return h.get("x-real-ip")?.trim() || (h.get("x-forwarded-for") ?? "").split(",").at(-1)?.trim() || null;
}

export async function forwardHeaders(): Promise<Record<string, string>> {
  const secret = process.env.CHANNEL_SECRET;
  const ip = await clientAddress();
  return {
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    // Always ours: whatever the browser sent is replaced, or dropped when no address is known.
    ...(ip ? { "x-forwarded-for": ip } : {}),
  };
}

export async function publicEngine<T>(path: string, init: RequestInit = {}): Promise<PublicResult<T>> {
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", ...(await forwardHeaders()) },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return res.ok
      ? { ok: true, status: res.status, data: body as T }
      : { ok: false, status: res.status, data: null as T, error: body ?? undefined };
  } catch {
    return { ok: false, status: 502, data: null as T };
  }
}

export async function visitorId(): Promise<string | null> {
  const v = (await cookies()).get(VISITOR_COOKIE)?.value;
  return v && isUuid(v) ? v : null;
}

/** The visitor's id, creating the cookie on first use. Only call from a server action or route handler. */
export async function ensureVisitorId(): Promise<string> {
  const existing = await visitorId();
  if (existing) return existing;
  const id = randomUUID();
  (await cookies()).set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return id;
}
