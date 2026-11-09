"use client";

import Link from "next/link";
import { useState } from "react";
import { AskAi } from "../../components/ask-ai";
import { Due, initials } from "../../components/ui";
import { buttonClass } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { Pill } from "../../components/ui/pill";
import { Segmented } from "../../components/ui/segmented";
import { askPrompts } from "../../lib/ask-ai/prompts";
import { roleLabel, shortDate } from "../../lib/format";
import type { RecordRow, TaskRow } from "../../lib/types";
import { workHref } from "./work/url";

type Filter = "all" | "approvals" | "tasks";

type Item = {
  key: string;
  type: "approval" | "task";
  name: string;
  sub: string;
  /** "application A-BZVJ2V" or "lease JLT-2205/2025-12", so Ask AI is about this record only. */
  ref?: string;
  dueOn: string | null;
  updatedAt: string;
  href: string;
  page?: { kind: "lease"; id: string };
};

function taskHref(t: TaskRow): string {
  if (t.entityKind === "lease") return workHref({}, { kind: "lease", id: t.entityId });
  if (t.entityKind === "application") return workHref({}, { kind: "application", id: t.entityId });
  if (t.entityKind === "conversation") return `/conversations/${t.entityId}`;
  return "/tasks";
}

/** Earliest due first; rows without a due date follow, newest update first. */
export function sortQueue(items: Item[]): Item[] {
  return items.toSorted((a, b) => {
    if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
    if (!!a.dueOn !== !!b.dueOn) return a.dueOn ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  });
}

export function HomeQueue({
  records,
  tasks,
  today,
  role,
}: {
  records: RecordRow[];
  tasks: TaskRow[];
  today: string;
  role: string | undefined;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const items = sortQueue([
    ...records
      .filter((r) => r.waitingForMe)
      .map<Item>((r) => ({
        key: `a:${r.kind}:${r.id}`,
        type: "approval",
        name: r.title,
        sub: `${r.unitCode} · ${r.nextStep}`,
        ref: `${r.kind} ${r.ref}`,
        dueOn: null,
        updatedAt: r.updatedAt,
        href: workHref({}, { kind: r.kind, id: r.id }),
        ...(r.kind === "lease" ? { page: { kind: "lease" as const, id: r.id } } : {}),
      })),
    ...tasks
      .filter((t) => t.status === "open" && (!role || t.assigneeRole === role))
      .map<Item>((t) => ({
        key: `t:${t.id}`,
        type: "task",
        name: t.title,
        sub: roleLabel(t.assigneeRole),
        dueOn: t.dueOn,
        updatedAt: t.createdAt,
        href: taskHref(t),
        ...(t.entityKind === "lease" ? { page: { kind: "lease" as const, id: t.entityId } } : {}),
      })),
  ]);
  const shown = items.filter((i) => filter === "all" || i.type + "s" === filter);
  const count = (f: Filter) => items.filter((i) => f === "all" || i.type + "s" === f).length;

  return (
    <section aria-labelledby="queue-h" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="queue-h" className="m-0 text-base font-semibold tracking-tight text-ink">
          Your queue
        </h2>
        <div className="flex items-center gap-3">
          <Segmented<Filter>
            label="Filter your queue"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All ${count("all")}` },
              { value: "approvals", label: `Approvals ${count("approvals")}` },
              { value: "tasks", label: `Tasks ${count("tasks")}` },
            ]}
          />
          <Link href="/tasks" className="font-sans text-sm text-ink underline underline-offset-2">
            All tasks
          </Link>
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title="Nothing waiting for you"
          action={
            <>
              {askPrompts.homeEmpty().map((p) => (
                <AskAi key={p.prompt} label={p.label} prompt={p.prompt} />
              ))}
            </>
          }
        />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {shown.map((i) => (
            <li
              key={i.key}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-page px-3.5 py-3 font-sans text-ink"
            >
              <span
                aria-hidden="true"
                className="grid size-10 flex-none place-items-center rounded-xl bg-raised text-[13px] font-semibold text-muted"
              >
                {initials(i.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{i.name}</div>
                <div className="truncate text-[13px] text-muted">{i.sub}</div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={i.type === "approval" ? "waiting" : "neutral"}>
                  {i.type === "approval" ? "Approval" : "Task"}
                </Pill>
                {i.dueOn ? (
                  <span className="flex items-center gap-1.5 text-[13px] text-muted">
                    <span className="num">{shortDate(i.dueOn)}</span>
                    {today && <Due today={today} on={i.dueOn} />}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Link href={i.href} className={buttonClass("ghost", "sm")}>
                  Open
                </Link>
                {askPrompts.queueRow(i.name, i.sub, i.ref).map((p) => (
                  <AskAi key={p.prompt} label={p.label} prompt={p.prompt} {...(i.page ? { page: i.page } : {})} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
