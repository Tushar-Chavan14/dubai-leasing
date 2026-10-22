"use client";

import { useState } from "react";
import { IconChevronLeft, IconChevronRight } from "../lib/icons";
import type { UnitPhoto } from "../lib/types";
import { PlanPlaceholder } from "./ui";

export function UnitGallery({
  unitId,
  code,
  photos,
  bedrooms,
  photoBase,
  emptyLabel = "No photos yet. Add them from Edit.",
}: {
  unitId: string;
  code: string;
  photos: Pick<UnitPhoto, "id" | "caption">[];
  bedrooms: number | null;
  /**
   * URL prefix photos load from (`<photoBase>/<photoId>`); a string so Server Components can pass
   * it. Defaults to the staff media route; the applicant portal proxies through its token.
   */
  photoBase?: string;
  emptyLabel?: string;
}) {
  const src = (id: string) => `${photoBase ?? `/media/units/${unitId}`}/${id}`;
  const [i, setI] = useState(0);
  const n = photos.length;
  const current = photos[Math.min(i, n - 1)];
  const go = (d: number) => setI((x) => (x + d + n) % n);

  if (!current) {
    return (
      <div className="gallery">
        <figure className="stage">
          <PlanPlaceholder bedrooms={bedrooms} label={emptyLabel} />
        </figure>
      </div>
    );
  }
  return (
    <div className="gallery">
      <figure
        className="stage"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
      >
        <img key={current.id} src={src(current.id)} alt={current.caption ?? `Unit ${code}, photo ${i + 1}`} />
        {current.caption && <figcaption>{current.caption}</figcaption>}
        {n > 1 && (
          <>
            <button type="button" className="nav-btn prev" onClick={() => go(-1)} aria-label="Previous photo">
              <IconChevronLeft />
            </button>
            <button type="button" className="nav-btn next" onClick={() => go(1)} aria-label="Next photo">
              <IconChevronRight />
            </button>
            <span className="pos" aria-live="polite">
              {i + 1} / {n}
            </span>
          </>
        )}
      </figure>
      {n > 1 && (
        <div className="thumbs" role="list" aria-label="Photos">
          {photos.map((p, k) => (
            <button
              key={p.id}
              type="button"
              role="listitem"
              aria-current={k === i}
              aria-label={p.caption ? `Show ${p.caption}` : `Show photo ${k + 1}`}
              onClick={() => setI(k)}
            >
              <img src={src(p.id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
