"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { publicEngine } from "../../lib/engine";
import { sessionCookie } from "../../lib/env";
import { keepSession } from "../../lib/session-cookie";

const keep = keepSession;

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const res = await publicEngine()
    .api.auth["sign-in"].$post({ json: { email, password } })
    .catch(() => null);
  if (!res?.ok) redirect(`/sign-in?error=${res?.status === 401 ? "wrong" : "down"}`);
  await keep(((await res.json()) as { token: string }).token);
  redirect("/");
}

export async function demoSignIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const res = await publicEngine()
    .api.auth["demo-sign-in"].$post({ json: { email } })
    .catch(() => null);
  if (!res?.ok) redirect("/sign-in?error=down");
  await keep(((await res.json()) as { token: string }).token);
  redirect("/");
}

export async function signOut() {
  (await cookies()).delete(sessionCookie());
  redirect("/sign-in");
}
