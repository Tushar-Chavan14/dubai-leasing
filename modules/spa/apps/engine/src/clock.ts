import { DemoClock } from "@platform/kernel";
import { type SpaDatabase, spaDemoSettings } from "@spa/db";
import { eq } from "drizzle-orm";

const DAY_MS = 86_400_000;

/**
 * The SPA demo clock (S2): system time plus the offset in `spa_demo_settings` (the `spa` database, never leasing's
 * `demo_settings`). The offset is cached and re-read by `refresh()`. Outside demo mode the offset is always 0.
 */
export class SpaDemoClock extends DemoClock {
  private offsetMs = 0;
  constructor(
    private readonly database: SpaDatabase,
    private readonly demoMode: boolean,
  ) {
    super(() => this.offsetMs);
  }
  get offsetDays(): number {
    return Math.round(this.offsetMs / DAY_MS);
  }
  async refresh(): Promise<void> {
    if (!this.demoMode) {
      this.offsetMs = 0;
      return;
    }
    const [row] = await this.database.db.select().from(spaDemoSettings).where(eq(spaDemoSettings.id, 1));
    this.offsetMs = row?.clockOffsetMs ?? 0;
  }
}
