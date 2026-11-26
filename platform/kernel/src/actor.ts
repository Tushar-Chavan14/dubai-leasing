/**
 * Who wrote an event, for any module (S4). `user:` and `copilot:` carry the staff user id; `helper:` the helper name.
 * A module adds its own outside parties through `Extra` (leasing: `tenant:`, `landlord:`, `enquirer:`).
 */
export type Actor<Extra extends string = never> =
  | "system"
  /** A named automatic job (a switch in Settings), e.g. `system:auto-release`, `system:auto-approve`. */
  | `system:${string}`
  | "import"
  | "demo"
  | `user:${string}`
  | `helper:${string}`
  | `copilot:${string}`
  | Extra;

export const userActor = (userId: string): `user:${string}` => `user:${userId}`;
export const helperActor = (name: string): `helper:${string}` => `helper:${name}`;
