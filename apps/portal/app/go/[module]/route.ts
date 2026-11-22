import { NextResponse } from "next/server";
import { handoffUrl } from "../../../lib/handoff";
import { portalEnv } from "../../../lib/env";
import { currentAccount, signInEnabled } from "../../../lib/server";

export const dynamic = "force-dynamic";

/**
 * "Open <module>": mints a 60-second token for that module and sends the browser to the module's `/auth/portal`.
 * No session: back to the portal's sign-in. Only the two known modules exist.
 */
export async function GET(request: Request, { params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const env = portalEnv();
  if (!signInEnabled(env) || (module !== "leasing" && module !== "spa")) return new NextResponse(null, { status: 404 });
  const account = await currentAccount();
  if (!account) return NextResponse.redirect(new URL("/sign-in", request.url), 303);
  const res = NextResponse.redirect(handoffUrl(env, module, account, Date.now()), 303);
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}
