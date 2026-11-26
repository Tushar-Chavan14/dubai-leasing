import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engineSend } from "./engine";
import { sendSettings, type SettingsRequest } from "./settings-forms";

/**
 * The tail every C40 Settings action shares: send the request the builder made (null means the form was not valid),
 * then redirect with one fixed code. The page shows fixed words for the code; the engine's own text never reaches it (S72).
 */
export async function finishSettings(
  req: SettingsRequest | null,
  back: string,
  saved: string,
  onConflict: "stale" | "blocked" | "exists" = "exists",
): Promise<never> {
  if (!req) redirect(`${back}?error=invalid`);
  const out = await sendSettings(engineSend, req);
  if (out === "signin") redirect("/sign-in");
  if (out === "done") {
    revalidatePath(back);
    redirect(`${back}?saved=${saved}`);
  }
  redirect(`${back}?error=${out === "exists" ? onConflict : out}`);
}
