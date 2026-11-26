import { type Clock, DemoClock, SystemClock } from "@leasing/core";
import { type Database, demoSettings } from "@leasing/db";
import { eq, sql } from "drizzle-orm";

const DAY_MS = 86_400_000;

/** Demo clock whose offset lives in `demo_settings` and is cached in memory. */
export class EngineDemoClock extends DemoClock {
  private offsetMs = 0;
  constructor(private readonly database: Database) {
    super(() => this.offsetMs);
  }
  get offset(): number {
    return this.offsetMs;
  }
  async refresh(): Promise<void> {
    const [row] = await this.database.db.select().from(demoSettings).where(eq(demoSettings.id, 1));
    this.offsetMs = row?.clockOffsetMs ?? 0;
  }
  async fastForward(days: number): Promise<void> {
    if (!Number.isInteger(days) || days < 1 || days > 800) throw new Error("days must be an integer 1–800");
    await this.database.db
      .insert(demoSettings)
      .values({ id: 1, clockOffsetMs: days * DAY_MS })
      .onConflictDoUpdate({
        target: demoSettings.id,
        set: { clockOffsetMs: sql`${demoSettings.clockOffsetMs} + ${days * DAY_MS}`, updatedAt: sql`now()` },
      });
    await this.refresh();
  }
  /**
   * Back to real time (offset 0). Data is kept: deadlines that already fired stay fired and
   * records stamped in the demo future keep their dates.
   */
  async rewind(): Promise<void> {
    await this.database.db
      .insert(demoSettings)
      .values({ id: 1, clockOffsetMs: 0 })
      .onConflictDoUpdate({ target: demoSettings.id, set: { clockOffsetMs: 0, updatedAt: sql`now()` } });
    await this.refresh();
  }
}

export async function createEngineClock(database: Database, demoMode: boolean): Promise<Clock> {
  if (!demoMode) return new SystemClock();
  const clock = new EngineDemoClock(database);
  await clock.refresh();
  return clock;
}
