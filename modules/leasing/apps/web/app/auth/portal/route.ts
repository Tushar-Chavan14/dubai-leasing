import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ENGINE_URL, SESSION_COOKIE } from "../../../lib/engine";
import { completeHandoff } from "../../../lib/portal-handoff";

export const dynamic = "force-dynamic";

/** Where the portal's "Open Leasing" lands (S70). Sets only `leasing_session`; the engine decides whether this email has a user. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const path = await completeHandoff({
    token,
    exchange: (t) =>
      fetch(`${ENGINE_URL}/api/auth/portal-exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-ip": "direct" },
        body: JSON.stringify({ token: t }),
        cache: "no-store",
      }),
    jar: await cookies(),
    cookieName: SESSION_COOKIE,
    secure: process.env.NODE_ENV === "production",
    failPath: "/login?error=portal",
  });
  const res = NextResponse.redirect(new URL(path, request.url), 303);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}
