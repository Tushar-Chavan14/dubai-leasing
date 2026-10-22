"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ENGINE_URL, SESSION_COOKIE } from "../../lib/engine";

export async function demoLogin(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const res = await fetch(`${ENGINE_URL}/api/auth/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) redirect("/login?error=1");
  const { token } = (await res.json()) as { token: string };
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 3600 });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
