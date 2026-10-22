import { type CalendarDate, toDubaiDate } from "./dates.ts";

/**
 * The only source of "now" in domain code. `SystemClock` in production; `DemoClock` adds an
 * offset (stored in `demo_settings`) so the demo can fast-forward.
 */
export interface Clock {
  now(): Date;
  /** Today's Asia/Dubai calendar date. */
  today(): CalendarDate;
}

abstract class BaseClock implements Clock {
  abstract now(): Date;
  today(): CalendarDate {
    return toDubaiDate(this.now());
  }
}

export class SystemClock extends BaseClock {
  now(): Date {
    return new Date(Date.now());
  }
}

/** System time plus an offset in ms. `getOffsetMs` is read on every call so updates apply at once. */
export class DemoClock extends BaseClock {
  constructor(
    private readonly getOffsetMs: () => number,
    private readonly base: Clock = new SystemClock(),
  ) {
    super();
  }
  now(): Date {
    return new Date(this.base.now().getTime() + this.getOffsetMs());
  }
}

/** Fixed clock for tests. */
export class FixedClock extends BaseClock {
  constructor(private instant: Date) {
    super();
  }
  now(): Date {
    return new Date(this.instant.getTime());
  }
  set(instant: Date): void {
    this.instant = instant;
  }
  advanceDays(days: number): void {
    this.instant = new Date(this.instant.getTime() + days * 86_400_000);
  }
}
