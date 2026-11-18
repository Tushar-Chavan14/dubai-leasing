import Link from "next/link";
import type { ReactNode } from "react";

/** Page header of the table pages: a 26px title, a grey sub line, and the page's actions on the right. */
export function PageTitle({
  title,
  lede,
  actions,
  back,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="grid gap-2">
      {back && (
        <Link href={back.href} className="w-fit text-[12.5px] text-muted! underline-offset-2 hover:underline">
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="m-0 font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          {lede && <p className="m-0 mt-1 max-w-[62ch] text-sm text-muted">{lede}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Filter links as pills with a count; the current one is black. */
export function TabLinks({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; count?: number; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.current ? "page" : undefined}
          className="rounded-full border border-line px-3 py-1.5 font-sans text-[13px] text-ink no-underline hover:border-ink aria-[current=page]:border-transparent aria-[current=page]:bg-primary aria-[current=page]:text-on-primary! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {i.label}
          {i.count !== undefined && <span className="ml-1.5 font-mono text-xs opacity-70">{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** A table in a rounded, bordered frame. */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-line bg-page">{children}</div>;
}

/** Link look for a name in a table or list row. */
export const ROW_LINK = "font-semibold text-ink! no-underline hover:underline";
