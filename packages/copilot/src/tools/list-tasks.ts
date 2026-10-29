import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import { workHref } from "../ui.ts";

const Input = z.object({
  scope: z.enum(["mine", "all"]).default("mine").describe("mine = tasks for the user's role; all = every role"),
  status: z.enum(["open", "done"]).default("open"),
  limit: z.number().int().min(1).max(20).default(10),
});
const Output = z.object({
  total: z.number().int().describe("How many tasks match, before the limit"),
  shown: z.number().int(),
  tasks: z.array(
    z.object({
      title: z.string(),
      kind: z.string(),
      status: z.string(),
      assigneeRole: z.string(),
      dueOn: z.string().nullable(),
      /** A path in the staff app: the record the task is on. */
      href: z.string().nullable(),
    }),
  ),
  note: z.string(),
});

interface Row {
  id: string;
  entityKind: string;
  entityId: string;
  kind: string;
  title: string;
  details: Record<string, unknown>;
  assigneeRole: string;
  status: string;
  dueOn: string | null;
}

export const listTasks: CopilotTool<typeof Input, typeof Output> = {
  name: "list_tasks",
  kind: "read",
  description:
    "Tasks for staff, earliest due first: open by default, for the user's role by default ('what's on my plate'), or for every role. Each has its title, due date and a link to the record. The engine returns open or all tasks; this tool does the mine (role) and done filtering itself. Read only; a person completes tasks in the Tasks page.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ scope, status, limit }, { engine, user }) {
    // The engine returns open tasks, or every task; done ones are picked out here.
    const rows = await engine.get<Row[]>(`/api/tasks?status=${status === "open" ? "open" : "all"}`);
    const wanted = rows.filter(
      (t) => t.status === status && (scope === "all" || t.assigneeRole === user.role || user.role === "admin"),
    );
    return {
      total: wanted.length,
      shown: Math.min(limit, wanted.length),
      tasks: wanted.slice(0, limit).map((t) => ({
        // Some titles quote tenant or applicant text; the engine marks those tasks untrusted.
        title: t.details.untrusted ? untrusted(t.title) : t.title,
        kind: t.kind,
        status: t.status,
        assigneeRole: t.assigneeRole,
        dueOn: t.dueOn,
        href: t.entityKind === "lease" || t.entityKind === "application" ? workHref(t.entityKind, t.entityId) : null,
      })),
      note:
        scope === "mine"
          ? "Tasks for the user's role. Completing one is done in the Tasks page, not here."
          : "Tasks for every role. Completing one is done in the Tasks page, not here.",
    };
  },
};
