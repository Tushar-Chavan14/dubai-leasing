import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { Pill } from "@platform/ui/pill";
import { ROW_CARD, Sub } from "@platform/ui/record";
import Link from "next/link";
import type { AlertItem } from "../lib/contracts";
import { shortDate } from "../lib/format";

/**
 * The alerts of the signed-in user (C23, S30, S62): the sentence the engine wrote (gate, deal and hours), when it was
 * raised, a link to the deal and "Mark read". Nothing here decides a gate.
 */
export function AlertList({
  items,
  markAction,
}: {
  items: AlertItem[];
  markAction: (formData: FormData) => void | Promise<void>;
}) {
  if (!items.length)
    return <EmptyState title="No alerts." body="You are told here when something waits for you for too long." />;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {items.map((a) => (
        <li key={a.id} className={`${ROW_CARD} m-0 flex flex-wrap items-center gap-x-4 gap-y-2`}>
          <div className="min-w-0 flex-1">
            <b className={`block [overflow-wrap:anywhere] ${a.readAt ? "font-normal text-muted" : "font-semibold"}`}>
              {a.text}
            </b>
            <Sub>Raised {shortDate(a.createdAt)}</Sub>
          </div>
          {a.level === "manager" && <Pill tone="warning">Escalated</Pill>}
          {a.readAt && <Pill tone="neutral">Read</Pill>}
          {a.dealId && (
            <Link href={`/work/deals/${a.dealId}`} className="text-[13px] text-ink underline underline-offset-2">
              Open deal
            </Link>
          )}
          {!a.readAt && (
            <form action={markAction}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className={buttonClass("ghost", "sm")}>
                Mark read
                <span className="sr-only">: {a.text}</span>
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
