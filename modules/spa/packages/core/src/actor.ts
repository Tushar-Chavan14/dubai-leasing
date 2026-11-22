import type { Actor } from "@platform/kernel/actor";

/** Who wrote an SPA event: the kernel's actors plus a party acting through its portal link (`party:<id>`). */
export type SpaActor = Actor<`party:${string}`>;
export const spaUserActor = (userId: string): SpaActor => `user:${userId}`;
