import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { Pill } from "@platform/ui/pill";
import { ROW_CARD, Sub } from "@platform/ui/record";
import { SPA_ROLE_LABELS, type SpaRole } from "@spa/core";
import Link from "next/link";
import type { TaskItem } from "../lib/contracts";
import { shortDate } from "../lib/format";
import { canFinishTask } from "../lib/work";

/**
 * Tasks (C30, S58). The only action is "Done" for a task of the viewer's own role (or any, for a sales manager): the
 * server action calls `POST /api/tasks/:id/done`, which checks it again. Nothing here decides a gate.
 */
export function TaskList({
  tasks,
  viewer,
  doneAction,
  emptyTitle = "No open tasks.",
}: {
  tasks: TaskItem[];
  viewer: SpaRole;
  doneAction: (formData: FormData) => void | Promise<void>;
  emptyTitle?: string;
}) {
  if (!tasks.length)
    return (
      <EmptyState title={emptyTitle} body="Tasks the system or a colleague opens for your role will be listed here." />
    );
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {tasks.map((t) => (
        <li key={t.id} className={`${ROW_CARD} m-0 flex flex-wrap items-center gap-x-4 gap-y-2`}>
          <div className="min-w-0 flex-1">
            <b className="block font-semibold [overflow-wrap:anywhere]">{t.title}</b>
            <Sub>
              For {SPA_ROLE_LABELS[t.role]} · opened {shortDate(t.createdAt)}
              {t.doneAt ? ` · done ${shortDate(t.doneAt)}` : ""}
            </Sub>
          </div>
          {t.status !== "open" && <Pill tone="accent">{t.status === "done" ? "Done" : "Cancelled"}</Pill>}
          {t.dealId && (
            <Link href={`/work/deals/${t.dealId}`} className="text-[13px] text-ink underline underline-offset-2">
              Open deal
            </Link>
          )}
          {canFinishTask(t, viewer) && (
            <form action={doneAction}>
              <input type="hidden" name="id" value={t.id} />
              <button type="submit" className={buttonClass("ghost", "sm")}>
                Mark done
                <span className="sr-only">: {t.title}</span>
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
