import Link from "next/link";
import type { ReactNode } from "react";
import { Cover } from "../media/cover";

/**
 * A catalogue card: cover, name, a subtitle line, facts and the price. The module passes ready strings and a ready
 * `src`; `footer` takes a secondary link under the card (e.g. "Ask about this in chat").
 */
export function PropertyCard({
  href,
  name,
  src,
  title,
  subtitle,
  price,
  priceNote,
  facts,
  badge,
  footer,
}: {
  href: string;
  /** Seeds the placeholder tile when there is no photo. */
  name: string;
  src?: string | undefined;
  title: string;
  subtitle?: string;
  price: string;
  /** Muted suffix after the price, e.g. "/yr". */
  priceNote?: string;
  facts: string[];
  badge?: string;
  footer?: ReactNode;
}) {
  return (
    <article className="grid gap-2.5">
      <Link
        href={href}
        className="group grid gap-3 rounded-[18px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        <span className="relative block aspect-[4/3] overflow-hidden rounded-[18px] bg-raised">
          <Cover
            name={name}
            src={src}
            alt=""
            className="transition-transform duration-500 ease-out motion-reduce:transition-none group-hover:scale-[1.02] motion-reduce:group-hover:scale-100"
          />
          {badge && (
            <span className="absolute top-3 left-3 rounded-full bg-page/90 px-2.5 py-0.5 text-xs font-semibold text-ink">
              {badge}
            </span>
          )}
        </span>
        <span className="flex items-start justify-between gap-4">
          <span className="grid gap-0.5">
            <b className="text-base leading-snug font-semibold tracking-tight">{title}</b>
            {subtitle !== undefined && <span className="text-sm text-muted">{subtitle}</span>}
            <span className="text-sm text-muted">{facts.join(" · ")}</span>
          </span>
          <span className="text-base font-semibold whitespace-nowrap tabular-nums">
            {price}
            {priceNote && <span className="font-normal text-muted">{` ${priceNote}`}</span>}
          </span>
        </span>
      </Link>
      {footer}
    </article>
  );
}
