"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { publicEngine } from "../../lib/engine";
import { sessionCookie, webEnv } from "../../lib/env";

const keep = async (token: string) =>
  (await cookies()).set(sessionCookie(), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 3600,
    // Outside demo mode the app runs behind HTTPS: the cookie never travels over plain HTTP.
    secure: !webEnv().SPA_DEMO_MODE,
  });

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
