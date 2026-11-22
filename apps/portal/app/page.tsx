import { redirect } from "next/navigation";
import { PortalHome } from "../components/portal-home";
import { portalEnv } from "../lib/env";
import { currentAccount, signedInTiles, signInEnabled } from "../lib/server";
import { loadTiles } from "../lib/tiles";
import { signOut } from "./actions";

/** Counts are read on every visit, never at build time. */
export const dynamic = "force-dynamic";

export default async function Page() {
  const env = portalEnv();
  // Without a signing key the portal is the C37 chooser: nothing changes (S70).
  if (!signInEnabled(env)) return <PortalHome tiles={await loadTiles(env)} />;
  const account = await currentAccount();
  if (!account) redirect("/sign-in");
  return <PortalHome tiles={await signedInTiles(env, account)} signedIn signOutAction={signOut} />;
}
