/** Hash every password the same way (argon2id). Bun runtime only. Used by the SPA engine and the portal (S70). */
export const hashPassword = (password: string): Promise<string> => Bun.password.hash(password, "argon2id");

/** A real hash to check against when the email is unknown, so a wrong email takes as long as a wrong password. */
let dummy: Promise<string> | null = null;
export async function checkPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash) return Bun.password.verify(password, hash);
  dummy ??= hashPassword("not-a-real-password");
  await Bun.password.verify(password, await dummy);
  return false;
}
