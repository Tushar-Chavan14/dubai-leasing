"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { THEME_COOKIE, themeOf } from "../lib/theme";

/** Works without JavaScript: a plain form post sets the cookie and the layout re-renders. */
export async function setTheme(formData: FormData) {
  (await cookies()).set(THEME_COOKIE, themeOf(formData.get("theme")), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
