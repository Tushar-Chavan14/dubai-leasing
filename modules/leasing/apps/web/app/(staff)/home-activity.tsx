import Link from "next/link";
import { ActivityItem, ActivityList } from "../../components/activity-item";
import { clockTime, relativeTime } from "../../lib/format";
import type { LogEntry } from "../../lib/types";
import { workHref } from "./work/url";

/** Home's "Agent activity today": a card of rows that open to the facts behind each action and link to its record. */
export function HomeActivity({ entries, today }: { entries: LogEntry[]; today: string }) {
  if (entries.length === 0)
    return (
      <p className="m-0 mt-3 rounded-card border border-line bg-page px-4 py-5 text-sm text-muted shadow-card">
        Nothing yet today.
      </p>
    );
  return (
    <div className="mt-3">
      <ActivityList boxed>
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
