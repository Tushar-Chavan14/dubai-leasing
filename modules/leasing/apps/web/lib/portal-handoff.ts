/**
 * The portal hand-off (C38, S70). The portal's "Open" link lands on `/auth/portal?token=...`; the engine checks the
 * token and, when this module has an active user for that email, answers with its own session. This function only
 * stores that session in this app's own cookie. It never sets, clears or reads any other app's cookie.
 */
export interface HandoffJar {
  set(
    name: string,
    value: string,
    options: { httpOnly: true; sameSite: "lax"; path: "/"; maxAge: number; secure: boolean },
  ): unknown;
}

/** The path to send the browser to: `/` when signed in, otherwise the sign-in page with a fixed `portal` reason. */
export async function completeHandoff(a: {
  token: string | null;
  exchange: (token: string) => Promise<Response | null>;
  jar: HandoffJar;
  cookieName: string;
  secure: boolean;
  failPath: string;
}): Promise<string> {
  if (!a.token || a.token.length > 2000) return a.failPath;
  const res = await a.exchange(a.token).catch(() => null);
  if (!res?.ok) return a.failPath;
  const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token !== "string") return a.failPath;
  a.jar.set(a.cookieName, body.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 3600,
    secure: a.secure,
  });
  return "/";
}
