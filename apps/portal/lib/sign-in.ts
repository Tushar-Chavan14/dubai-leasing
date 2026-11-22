import { createExchangeLimiter, type ExchangeLimiter } from "@platform/kernel/portal-exchange";
import { type Account, type AccountStore, authenticate, normaliseEmail } from "./accounts.ts";

export type SignInResult = { ok: true; account: Account } | { ok: false; reason: "wrong" | "slow" };

/** The one answer for every failed sign-in. */
export const WRONG = "That email and password don't match. Try again.";
export const SLOW = "Too many attempts. Wait a minute and try again.";

/** Sign-in attempts are limited per IP and per email, like the modules' exchange (S70). */
export const signInLimiter: ExchangeLimiter = createExchangeLimiter();

export async function signInWith(
  store: AccountStore,
  limiter: ExchangeLimiter,
  input: { email: string; password: string; ip: string; nowMs: number },
): Promise<SignInResult> {
  const email = normaliseEmail(input.email);
  if (
    !limiter.allow("exchange", "ip", input.ip, input.nowMs) ||
    !limiter.allow("exchange", "email", email, input.nowMs)
  )
    return { ok: false, reason: "slow" };
  const account = await authenticate(store, email, input.password);
  return account ? { ok: true, account } : { ok: false, reason: "wrong" };
}
