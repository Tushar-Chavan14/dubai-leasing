import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { clientBucket } from "../../../lib/client-address";
import { engineUrl, sessionCookie, webEnv } from "../../../lib/env";
import { completeHandoff } from "../../../lib/portal-handoff";

export const dynamic = "force-dynamic";

/** Where the portal's "Open Sales" lands (S70). Sets only `spa_session`; the engine decides whether this email has a user. */
export async function GET(request: Request) {
  const env = webEnv();
  const token = new URL(request.url).searchParams.get("token");
  const ip = clientBucket(await headers(), env.SPA_TRUSTED_PROXY);
  const path = await completeHandoff({
    token,
    exchange: (t) =>
      fetch(`${engineUrl()}/api/auth/portal-exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-ip": ip },
        body: JSON.stringify({ token: t }),
        cache: "no-store",
      }),
    jar: await cookies(),
    cookieName: sessionCookie(),
    secure: !env.SPA_DEMO_MODE,
    failPath: "/sign-in?error=portal",
  });
  const res = NextResponse.redirect(new URL(path, request.url), 303);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}
