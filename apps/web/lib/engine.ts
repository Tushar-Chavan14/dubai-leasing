import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/** Server-side only: calls the engine API with the staff session from the httpOnly cookie. */
export const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";
export const SESSION_COOKIE = "leasing_session";

export interface EngineResult<T> {
  ok: boolean;
  status: number;
  data: T;
  error?: { error: string; code: string; reasons?: string[] };
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function engine<T>(path: string, init: RequestInit = {}): Promise<EngineResult<T>> {
  const token = await sessionToken();
  if (!token) redirect("/login");
  const res = await fetch(`${ENGINE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (res.status === 401) redirect("/login");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return res.ok
    ? { ok: true, status: res.status, data: body as T }
    : { ok: false, status: res.status, data: null as T, error: body };
}

/** For pages: throw on errors other than 404 so the error boundary shows them. */
export async function get<T>(path: string): Promise<T | null> {
  const r = await engine<T>(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.error?.error ?? `engine returned ${r.status}`);
  return r.data;
}

export async function publicGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`${ENGINE_URL}${path}`, { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json()) as T) : null;
}

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Engine error → message and reasons for a form, in sentence case. */
export function formError(r: EngineResult<unknown>): { error: string; reasons: string[] } {
  return {
    error: sentence(r.error?.error ?? `Engine returned ${r.status}`),
    reasons: (r.error?.reasons ?? []).map(sentence),
  };
}
