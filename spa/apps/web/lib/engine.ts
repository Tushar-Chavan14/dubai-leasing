import type { SpaApp } from "@spa/engine";
import { hc } from "hono/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { engineUrl, sessionCookie } from "./env";

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
