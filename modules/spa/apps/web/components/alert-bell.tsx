import { BellIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/**
 * The bell in the shell (C23, S62): a link to the alerts page. The count is said in words for a screen reader and drawn as
 * a badge only when above zero. It shows a number, never a sentence: the words of an alert are on the page.
 */
export function AlertBell({ unread }: { unread: number }) {
  return (
    <Link
      href="/alerts"
      title="Alerts"
      className="relative inline-flex size-9 items-center justify-center rounded-full border border-line !text-ink no-underline hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <BellIcon size={18} aria-hidden />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-on-primary"
        >
          {unread}
        </span>
      )}
      <span className="sr-only">
        {unread > 0 ? `${unread} unread alert${unread === 1 ? "" : "s"}` : "No unread alerts"}
      </span>
    </Link>
  );
}
