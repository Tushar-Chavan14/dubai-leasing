// Type only (erased at build): a path import, so the web package does not depend on the engine package and
// `bun run --filter` (dev:spa) does not wait for the engine's never-ending dev script.
import type { SpaApp } from "../../engine/src/app.ts";
import { hc } from "hono/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { engineUrl, sessionCookie } from "./env";
import type { SendJson } from "./catalogue";
import type { Send } from "./inbox";

/** The typed engine client (Hono RPC). Server-side only. */
export const publicEngine = () => hc<SpaApp>(engineUrl(), { init: { cache: "no-store" } });

/** The typed client as the signed-in user; no session → the sign-in page. */
export async function engine() {
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) redirect("/sign-in");
  return hc<SpaApp>(engineUrl(), { headers: { authorization: `Bearer ${token}` }, init: { cache: "no-store" } });
}

/** Reads a JSON response; a 401 sends the user to sign in again. */
export async function read<T>(res: { ok: boolean; status: number; json(): Promise<T> }): Promise<T | null> {
  if (res.status === 401) redirect("/sign-in");
  return res.ok ? res.json() : null;
}

/**
 * GET one engine route as the signed-in user and parse the answer. Not found or not allowed is null (the page shows
 * its 404); a 401 sends the user to sign in; an answer in an unexpected shape is an error, never shown half-parsed.
 */
export async function engineGet<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S> | null> {
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) redirect("/sign-in");
  const res = await fetch(`${engineUrl()}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/sign-in");
  // A hand-edited address (a bad filter or cursor, 400) is a page that is not there, never a crash.
  if (res.status === 400 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error("The sales engine didn't answer. Try again in a moment.");
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new Error("The sales engine answered in a way this page doesn't understand.");
  return parsed.data;
}

/** A POST to the engine as the signed-in user, answering with the response (the Inventory forms read the new id). */
export const enginePostJson: SendJson = async (path, init) => {
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) redirect("/sign-in");
  return fetch(`${engineUrl()}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
    cache: "no-store",
  });
};

/** A POST to the engine as the signed-in user, for the server actions that send a body (the decision form, C31). */
export const enginePost: Send = enginePostJson;

/** Any write to the engine as the signed-in user (PUT and multipart for the Settings screens, C34). */
export const engineSend = async (
  path: string,
  init: { method: "POST" | "PUT"; headers?: Record<string, string>; body: string | FormData },
): Promise<{ status: number; json(): Promise<unknown> }> => {
  const token = (await cookies()).get(sessionCookie())?.value;
  if (!token) redirect("/sign-in");
  return fetch(`${engineUrl()}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
    cache: "no-store",
  });
};
