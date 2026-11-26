import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { href: string; label: string };

/**
 * Breadcrumbs on every sub page: a back arrow to the nearest parent, the trail of parents, then the current page.
 * On a phone only the back link to the nearest parent shows.
 */
export function Breadcrumbs({ trail, current }: { trail: Crumb | Crumb[]; current?: ReactNode }) {
  const items = Array.isArray(trail) ? trail : [trail];
  const parent = items[items.length - 1];
  if (!parent) return null;
  return (
    <nav aria-label="Breadcrumb" className="font-sans text-[13px]">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
        <li className="sm:hidden">
          <Link
            href={parent.href}
            className="inline-flex items-center gap-1 font-semibold text-muted! no-underline hover:text-ink!"
          >
            <CaretLeftIcon size={14} weight="bold" aria-hidden />
            {parent.label}
          </Link>
        </li>
        {items.map((c, i) => (
          <li key={c.href} className="hidden items-center gap-1.5 sm:flex">
            <Link
              href={c.href}
              className="inline-flex items-center gap-1 font-medium text-muted! no-underline hover:text-ink! hover:underline underline-offset-2"
            >
              {i === 0 && <CaretLeftIcon size={14} weight="bold" aria-hidden />}
              {c.label}
            </Link>
            <CaretRightIcon size={11} weight="bold" aria-hidden className="text-muted opacity-60" />
          </li>
        ))}
        {current && (
          <li aria-current="page" className="hidden max-w-[40ch] truncate font-semibold text-ink sm:block">
            {current}
          </li>
        )}
      </ol>
    </nav>
  );
}

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
  /** The parent page, or the trail of parents (outermost first). Shown as breadcrumbs above the title. */
  back?: Crumb | Crumb[];
}) {
  return (
    <header className="grid gap-2">
      {back && <Breadcrumbs trail={back} current={typeof title === "string" ? title : undefined} />}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="m-0 font-sans text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
          {lede && <p className="m-0 mt-1 max-w-[62ch] text-sm text-muted">{lede}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Filter links as pills with a count; the current one is a soft blue pill. */
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
          className="rounded-full border border-transparent px-3.5 py-1.5 font-sans text-[13.5px] font-medium text-muted! no-underline hover:bg-raised hover:text-ink! aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-on-accent! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
  return <div className="overflow-x-auto rounded-2xl border border-line bg-page shadow-card">{children}</div>;
}

/** Link look for a name in a table or list row. */
export const ROW_LINK = "font-semibold text-ink! no-underline hover:underline";
