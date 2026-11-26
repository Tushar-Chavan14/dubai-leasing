import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The staff Units card (leasing's Units screen, shared with the sales Inventory): a photo (or the module's placeholder),
 * the code in bold with the status pill on the same line, a subtitle, a facts line, the price on its own line and an
 * optional chip (the lease or the deal). The whole card is one link, so nothing inside it is a link.
 */
export function StaffUnitCard({
  href,
  imageSrc,
  imageAlt,
  placeholder,
  photoCount = 0,
  code,
  status,
  subtitle,
  facts,
  price,
  chip,
}: {
  href: string;
  /** A ready URL; absent draws `placeholder`. */
  imageSrc?: string | undefined;
  imageAlt: string;
  placeholder: ReactNode;
  photoCount?: number;
  code: string;
  status: ReactNode;
  subtitle: ReactNode;
  facts: ReactNode;
  price: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group grid gap-3 text-ink! no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-raised">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={imageAlt}
            loading="lazy"
            width={520}
            height={390}
            className="block h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          placeholder
        )}
        {photoCount > 1 && (
          <span className="absolute bottom-2.5 right-2.5 rounded-full bg-page/90 px-2 py-0.5 font-sans text-xs font-semibold text-ink">
            {photoCount} photos
          </span>
        )}
      </div>
      <div className="grid gap-0.5 font-sans">
        <div className="flex items-center justify-between gap-2">
          <b className="min-w-0 truncate text-[15px] font-semibold group-hover:underline">{code}</b>
          {status}
        </div>
        <span className="text-[13px] text-muted">{subtitle}</span>
        <span className="text-[13px] text-muted">{facts}</span>
        <span className="text-[13px] text-muted">{price}</span>
        {chip && <span className="mt-1">{chip}</span>}
      </div>
    </Link>
  );
}
