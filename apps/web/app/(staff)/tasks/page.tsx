import type { Metadata } from "next";
import Link from "next/link";
import { Due, Empty, PageHead } from "../../../components/ui";
import { TaskActions } from "../../../components/work-forms";
import { get, publicGet } from "../../../lib/engine";
import { roleLabel, shortDate } from "../../../lib/format";
import { IconChecklist } from "../../../lib/icons";
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
    <>
      <PageHead
        title="Tasks"
        lede="Person-led work the engine creates: questions for landlords, notices to send, deadlines that slipped. Sorted by due date."
      />
      <nav className="tabs" aria-label="Filter tasks">
        <Link href="/tasks" aria-current={mineOnly ? "page" : undefined}>
          For {me ? roleLabel(me.role).toLowerCase() : "me"}
          <span className="n">{me ? all.filter((t) => t.assigneeRole === me.role).length : 0}</span>
        </Link>
        <Link href="/tasks?for=all" aria-current={!mineOnly ? "page" : undefined}>
          Everyone
          <span className="n">{all.length}</span>
        </Link>
      </nav>
      <section className="panel">
        {rows.length === 0 ? (
          <Empty icon={<IconChecklist />} title="No open tasks">
            Tasks appear when a milestone needs a person, for example asking the landlord about a sale 13 months before
            a lease ends.
          </Empty>
        ) : (
          <ul className="list">
            {rows.map((t) => (
              <li key={t.id} className="list-row">
                <div>
                  <Link href={taskHref(t)} className="title link-plain">
                    {t.title}
                  </Link>
                  <div className="meta">
                    <span>{roleLabel(t.assigneeRole)}</span>
                    <span>Created {shortDate(t.createdAt.slice(0, 10))}</span>
                  </div>
                  {me && <TaskActions task={t} role={me.role} today={today} />}
                </div>
                <div className="side">
                  {t.dueOn ? (
                    <>
                      <span className="num">{shortDate(t.dueOn)}</span>
                      {today && <Due today={today} on={t.dueOn} />}
                    </>
                  ) : (
                    <span className="muted">No due date</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
