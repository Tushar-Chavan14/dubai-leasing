import { PgBoss } from "pg-boss";
import type { Clock } from "@platform/kernel";

/** Proves the SPA queue runs: a no-op job, at most one per Dubai day (S2; same singletonKey rule as D2). */
export const HEARTBEAT_JOB = "spa.heartbeat";
export const heartbeatKey = (today: string) => `engine:heartbeat:${today}`;

/** pg-boss in the `spa` database only, in its own `pgboss` schema (never leasing's queue). */
export function createBoss(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
}

export interface Jobs {
  boss: PgBoss;
  /** When the last heartbeat job ran (wall clock), or null before the first. */
  lastHeartbeat(): Date | null;
  stop(): Promise<void>;
}

export async function startJobs(boss: PgBoss, clock: Clock): Promise<Jobs> {
  let last: Date | null = null;
  await boss.start();
  await boss.createQueue(HEARTBEAT_JOB, { policy: "exclusive" });
  await boss.work(HEARTBEAT_JOB, async () => {
    last = clock.now();
  });
  // Safe to send twice: the exclusive queue keeps one queued or active job per key.
  await boss.send(HEARTBEAT_JOB, {}, { singletonKey: heartbeatKey(clock.today()) });
  return {
    boss,
    lastHeartbeat: () => last,
    stop: () => boss.stop({ graceful: true }),
  };
}
