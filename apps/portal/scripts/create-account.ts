import { z } from "zod";
import { createAccount } from "../lib/accounts.ts";
import { createPortalDatabase } from "../lib/db.ts";
import { loadPortalEnv } from "../lib/env.ts";

/**
 * `bun run portal:create-account you@example.com` creates a portal account (there is no self sign-up). The password is
 * typed without echo (or piped on stdin) and is never printed. The account has no role: each module's own user decides.
 */
const email = z.email().safeParse(process.argv[2]);
if (!email.success) {
  console.error("usage: bun run portal:create-account <email>");
  process.exit(1);
}
const url = loadPortalEnv().PORTAL_DATABASE_URL;
if (!url) throw new Error("PORTAL_DATABASE_URL is not set in .env.portal.local");

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return (await Bun.stdin.text()).split("\n")[0] ?? "";
  process.stdout.write("Password (at least 12 characters, not shown): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let typed = "";
  return new Promise((resolve) => {
    process.stdin.on("data", (chunk) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          return resolve(typed);
        }
        if (ch === "\u0003") process.exit(130);
        typed = ch === "\u007f" ? typed.slice(0, -1) : typed + ch;
      }
    });
  });
}

const password = await readPassword();
if (password.length < 12) {
  console.error("the password must be at least 12 characters");
  process.exit(1);
}
const database = createPortalDatabase(url, { max: 1 });
try {
  const a = await createAccount(database, email.data, password);
  console.log(`portal account created for ${a.email}`);
} catch (e) {
  console.error(
    (e as { code?: string }).code === "23505" ? "that email already has an account" : "could not create the account",
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
