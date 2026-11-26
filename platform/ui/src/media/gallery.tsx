"use client";

import { useState, type ReactNode } from "react";
import { CaretLeftIcon as IconChevronLeft, CaretRightIcon as IconChevronRight } from "@phosphor-icons/react";

export interface GalleryPhoto {
  id: string;
  /** A ready URL: nothing is rewritten here. */
  src: string;
  caption?: string | null;
}

/** Photo gallery: one large photo with arrows and a thumbnail strip. Shows `placeholder` when there are none. */
export function Gallery({
  title,
  photos,
  placeholder,
  emptyLabel = "No photos yet.",
}: {
  /** Names the photos for screen readers: "<title>, photo 2". */
  title: string;
  photos: GalleryPhoto[];
  placeholder?: ReactNode;
  emptyLabel?: string;
}) {
  const [i, setI] = useState(0);
  const n = photos.length;
  const current = photos[Math.min(i, n - 1)];
  const go = (d: number) => setI((x) => (x + d + n) % n);

  if (!current) {
    return (
      <div className="relative aspect-[16/10] max-h-[460px] w-full overflow-hidden rounded-3xl border border-line">
        {placeholder ?? (
          <div className="grid h-full w-full place-items-center bg-raised font-sans text-xs text-muted">
            {emptyLabel}
          </div>
        )}
      </div>
    );
  }
  const NAV =
    "absolute top-1/2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-line bg-page/90 text-ink opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none";
  return (
    <div className="grid gap-2.5">
      <figure
        className="group relative m-0 aspect-[16/10] max-h-[460px] w-full overflow-hidden rounded-3xl border border-line bg-raised"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
      >
        <img
          key={current.id}
          src={current.src}
          alt={current.caption ?? `${title}, photo ${i + 1}`}
          className="block h-full w-full object-cover"
        />
        {current.caption && (
          <figcaption className="absolute bottom-3 left-3 max-w-[70%] rounded-full bg-page/90 px-3 py-1 font-sans text-xs text-ink">
            {current.caption}
          </figcaption>
        )}
        {n > 1 && (
          <>
            <button type="button" className={`${NAV} left-3`} onClick={() => go(-1)} aria-label="Previous photo">
              <IconChevronLeft size={18} />
            </button>
            <button type="button" className={`${NAV} right-3`} onClick={() => go(1)} aria-label="Next photo">
              <IconChevronRight size={18} />
            </button>
            <span
              className="absolute bottom-3 right-3 rounded-full bg-page/90 px-2.5 py-1 font-sans text-xs font-semibold text-ink"
              aria-live="polite"
            >
              {i + 1} / {n}
            </span>
          </>
        )}
      </figure>
      {n > 1 && (
        <div className="flex flex-wrap gap-2" role="list" aria-label="Photos">
          {photos.map((p, k) => (
            <button
              key={p.id}
              type="button"
              role="listitem"
              aria-current={k === i}
              aria-label={p.caption ? `Show ${p.caption}` : `Show photo ${k + 1}`}
              onClick={() => setI(k)}
              className="size-14 cursor-pointer overflow-hidden rounded-xl border border-line bg-raised p-0 opacity-70 hover:opacity-100 aria-[current=true]:border-ink aria-[current=true]:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <img src={p.src} alt="" loading="lazy" className="block h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
