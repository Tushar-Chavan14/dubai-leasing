import Link from "next/link";
import { ActivityItem, ActivityList } from "../../components/activity-item";
import { clockTime, relativeTime } from "../../lib/format";
import type { LogEntry } from "../../lib/types";
import { workHref } from "./work/url";

/** Home's "Agent activity today": a card of rows that open to the facts behind each action and link to its record. */
export function HomeActivity({ entries, today }: { entries: LogEntry[]; today: string }) {
  if (entries.length === 0)
    return (
      <p className="m-0 py-5 text-center text-sm text-muted">Nothing yet today.</p>
    );
  return (
    <div>
      <ActivityList className="!-mx-[18px] !-mb-4">
        {entries.map((e) => (
          <ActivityItem
            key={`${e.source}:${e.refId}`}
            entry={e}
            stamp={clockTime(e.at)}
            stampTitle={relativeTime(today, e.at)}
            note={e.record?.unitCode}
            footer={
              e.record && (
                <Link
                  href={workHref({}, { kind: e.record.kind, id: e.record.id })}
                  className="w-fit text-[13px] font-semibold text-primary! underline-offset-2 hover:underline"
                >
                  Open {e.record.title} · {e.record.ref} →
                </Link>
              )
            }
          />
        ))}
      </ActivityList>
    </div>
  );
}
