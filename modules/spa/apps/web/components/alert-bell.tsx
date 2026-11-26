import { BellIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/**
 * The bell in the shell (C23, S62): a link to the alerts page. The count is said in words for a screen reader and drawn as
 * a badge only when above zero. It shows a number, never a sentence: the words of an alert are on the page.
 * `rail` is the icon-over-label button in the navy rail; `page` is the round outline button.
 */
export function AlertBell({ unread, variant = "page" }: { unread: number; variant?: "page" | "rail" }) {
  const words = (
    <span className="sr-only">
      {unread > 0 ? `${unread} unread alert${unread === 1 ? "" : "s"}` : "No unread alerts"}
    </span>
  );
  if (variant === "rail") {
    return (
      <Link
        href="/alerts"
        title="Alerts"
        className="relative flex w-[60px] flex-col items-center gap-1 rounded-[14px] pb-1.5 pt-2 text-[11px] font-medium leading-none !text-rail-ink no-underline transition-colors duration-200 hover:bg-white/8 hover:!text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      >
        <BellIcon size={20} aria-hidden />
        <span aria-hidden="true">Alerts</span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute left-[calc(50%+3px)] top-[1px] grid h-4 min-w-4 place-items-center rounded-full border-2 border-rail bg-white px-1 text-[10px] font-bold leading-none text-rail box-content"
          >
            {unread}
          </span>
        )}
        {words}
      </Link>
    );
  }
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
      {words}
    </Link>
  );
}
