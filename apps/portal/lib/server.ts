import { cookies, headers } from "next/headers";
import { type Account, accountStore, activeAccount } from "./accounts.ts";
import { checkAccess, type PostFetcher } from "./access.ts";
import { portalDatabase } from "./db.ts";
import { portalEnv, type PortalEnv } from "./env.ts";
import { PORTAL_COOKIE, readPortalSession } from "./session.ts";
import { loadSignedInTiles, type Tile } from "./tiles.ts";

/** Sign-in is on only when a signing key is configured; otherwise the portal is the C37 chooser. */
export const signInEnabled = (env: PortalEnv = portalEnv()): boolean => !!env.PORTAL_SIGNING_KEY;

export function database(env: PortalEnv = portalEnv()) {
  if (!env.PORTAL_DATABASE_URL) throw new Error("PORTAL_DATABASE_URL is not set");
  return portalDatabase(env.PORTAL_DATABASE_URL);
}
export const store = () => accountStore(database());

/** The signed-in, still active account for this request, or null. */
export async function currentAccount(): Promise<Account | null> {
  const env = portalEnv();
  if (!env.PORTAL_SESSION_SECRET) return null;
  const id = readPortalSession(env.PORTAL_SESSION_SECRET, (await cookies()).get(PORTAL_COOKIE)?.value, Date.now());
  return id ? activeAccount(database(env), id) : null;
}

/** The visitor's address for the sign-in limit: the last `x-forwarded-for` entry a proxy appended, else `direct`. */
export async function clientIp(): Promise<string> {
  const last = (await headers()).get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "";
  return /^[0-9a-fA-F:.]{2,45}$/.test(last) ? last : "direct";
}

/** The signed-in chooser's tiles: asks each engine whether this email has an active user there (S70). */
export async function signedInTiles(env: PortalEnv, account: Account): Promise<Tile[]> {
  const access = await checkAccess(env, account, fetch as PostFetcher, Date.now());
  return loadSignedInTiles(env, access);
}
