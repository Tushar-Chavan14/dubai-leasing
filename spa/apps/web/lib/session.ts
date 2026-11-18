import { railItems, type RailScreen } from "@spa/core/roles";
import { notFound } from "next/navigation";
import { cache } from "react";
import { engine, read } from "./engine";

/** The signed-in user (once per request); no session or an expired one → sign-in page. */
export const me = cache(async () => {
  const client = await engine();
  const user = await read(await client.api.me.$get());
  if (!user) throw new Error("The sales engine didn't answer. Try again in a moment.");
  return user;
});

/** A screen the role has no rail item for is not found (the engine refuses its actions anyway). */
export async function requireScreen(screen: RailScreen) {
  const user = await me();
  const item = railItems(user.role).find((i) => i.screen === screen);
  if (!item) notFound();
  return { user, item };
}
