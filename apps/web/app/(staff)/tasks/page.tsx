import type { Metadata } from "next";
import Link from "next/link";
import { Due } from "../../../components/ui";
import { EmptyState } from "../../../components/ui/empty-state";
import { PageTitle, TabLinks } from "../../../components/ui/page";
import { ROW_CARD, Sub } from "../../../components/ui/record";
import { TaskActions } from "../../../components/work-forms";
import { get, publicGet } from "../../../lib/engine";
import { roleLabel, shortDate } from "../../../lib/format";
import type { Me, TaskRow } from "../../../lib/types";

export const metadata: Metadata = { title: "Tasks" };

function taskHref(t: TaskRow): string {
  if (t.entityKind === "lease") return `/work?kind=lease&id=${t.entityId}`;
  if (t.entityKind === "application") return `/work?kind=application&id=${t.entityId}`;
  if (t.entityKind === "conversation") return `/conversations/${t.entityId}`;
  return "/tasks";
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const { for: scope } = await searchParams;
  const [tasks, me, health] = await Promise.all([
    get<TaskRow[]>("/api/tasks"),
    get<Me>("/api/me"),
    publicGet<{ today: string }>("/health"),
  ]);
  const all = tasks ?? [];
  const mineOnly = scope !== "all";
  const rows = mineOnly && me ? all.filter((t) => t.assigneeRole === me.role) : all;
  const today = health?.today ?? "";

  return (
    <div className="grid gap-5">
      <PageTitle
        title="Tasks"
        lede="Person-led work the engine creates: questions for landlords, notices to send, deadlines that slipped. Sorted by due date."
      />
      <TabLinks
        label="Filter tasks"
        items={[
          {
            href: "/tasks",
            label: `For ${me ? roleLabel(me.role).toLowerCase() : "me"}`,
            count: me ? all.filter((t) => t.assigneeRole === me.role).length : 0,
            current: mineOnly,
          },
          { href: "/tasks?for=all", label: "Everyone", count: all.length, current: !mineOnly },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No open tasks"
          body="Tasks appear when a milestone needs a person, for example asking the landlord about a sale 13 months before a lease ends."
        />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {rows.map((t) => (
            <li key={t.id} className={`${ROW_CARD} flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3.5`}>
              <div className="grid min-w-0 gap-1">
                <Link href={taskHref(t)} className="font-semibold text-ink! no-underline hover:underline">
                  {t.title}
                </Link>
                <Sub>
                  {roleLabel(t.assigneeRole)} · Created {shortDate(t.createdAt.slice(0, 10))}
                </Sub>
                {me && <TaskActions task={t} role={me.role} today={today} />}
              </div>
              <div className="grid justify-items-end gap-0.5 text-sm">
                {t.dueOn ? (
                  <>
                    <span className="font-semibold tabular-nums">{shortDate(t.dueOn)}</span>
                    {today && <Due today={today} on={t.dueOn} />}
                  </>
                ) : (
                  <span className="text-muted">No due date</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
