"use client";

import { Gallery } from "@platform/ui/media/gallery";
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
  return (
    <Gallery
      title={`Unit ${code}`}
      photos={photos.map((p) => ({ id: p.id, src: src(p.id), caption: p.caption }))}
      placeholder={<PlanPlaceholder bedrooms={bedrooms} label={emptyLabel} />}
    />
  );
}
