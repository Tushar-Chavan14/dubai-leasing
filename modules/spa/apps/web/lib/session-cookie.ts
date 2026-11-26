import { cookies } from "next/headers";
import { sessionCookie, webEnv } from "./env";

/** Keeps the engine's session token in the httpOnly cookie (sign-in and the demo switch both end here). */
export const keepSession = async (token: string) =>
  (await cookies()).set(sessionCookie(), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 3600,
    // Outside demo mode the app runs behind HTTPS: the cookie never travels over plain HTTP.
    secure: !webEnv().SPA_DEMO_MODE,
  });
