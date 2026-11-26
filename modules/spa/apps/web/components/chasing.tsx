import { Pill } from "@platform/ui/pill";
import { ROW_CARD, Section, Sub } from "@platform/ui/record";
import type { ChasingSection } from "../lib/contracts";
import { shortDate } from "../lib/format";

const days = (d: readonly number[]): string =>
  d.length === 0 ? "no days" : d.length === 1 ? `${d[0]}` : `${d.slice(0, -1).join(", ")} and ${d.at(-1)}`;

/**
 * Chasing (C25, S23, S60): what each party still owes, what was sent and the schedule. The reasons are the fixed words
 * the party read, and anything compliance asked for reads "Additional documents needed" for everyone. Read only: an agent
 * pauses or resumes through the engine's route, and an admin approves the email (C34).
 */
export function Chasing({ section }: { section: ChasingSection }) {
  const { open, history, schedule, template } = section;
  return (
    <Section id="chasing" title="Chasing" hint="Fixed reminder emails about what a party still owes">
      <div className="grid gap-3">
        <span className="flex flex-wrap items-center gap-2">
          {section.paused ? <Pill tone="warning">Paused</Pill> : <Pill tone="accent">Running</Pill>}
          {template ? <Sub>Email version {template.version}</Sub> : null}
        </span>
        {section.paused && section.pausedSince && <Sub>Chasing is paused since {shortDate(section.pausedSince)}.</Sub>}
        {!template && <Sub>No approved chase email yet. Nothing is sent until an admin approves one.</Sub>}
        <Sub>
          Reminders after {days(schedule.reminderDays)} days, then a task for the agent after {schedule.taskAfterDays}{" "}
          days
        </Sub>
        {open.length === 0 && history.length === 0 && <Sub>Nothing is owed by any party.</Sub>}
        {open.length > 0 && (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Still owed">
            {open.map((o) => (
              <li key={`${o.partyName}-${o.item}`} className={`${ROW_CARD} m-0 grid gap-0.5`}>
                <b className="font-semibold">{o.partyName}</b>
                <Sub>{o.item === o.reason ? o.item : `${o.item} · ${o.reason}`}</Sub>
                <Sub>
                  {o.chased === 0 || !o.lastChasedAt
                    ? "Not chased yet"
                    : `Chased ${o.chased} ${o.chased === 1 ? "time" : "times"}, last on ${shortDate(o.lastChasedAt)}`}
                </Sub>
              </li>
            ))}
          </ul>
        )}
        {history.length > 0 && (
          <ul className="m-0 grid list-none gap-1 p-0" aria-label="Sent">
            {history.map((h) => (
              <li key={`${h.partyName}-${h.step}-${h.sentAt}-${h.reason}`} className="m-0 text-[13px] text-muted">
                {shortDate(h.sentAt)} · {h.partyName} · {h.step === 0 ? "Asked" : `Reminder ${h.step}`} · {h.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
