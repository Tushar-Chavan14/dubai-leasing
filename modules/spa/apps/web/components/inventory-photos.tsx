"use client";

import { Cover } from "@platform/ui/media/cover";
import { Gallery } from "@platform/ui/media/gallery";
import { PlanPlaceholder } from "@platform/ui/media/plan-placeholder";
import { PhotoManager } from "@platform/ui/media/photo-manager";
import type { MediaOwnerKind } from "@spa/core";
import { captionMediaAction, removeMediaAction, reorderMediaAction } from "../app/(staff)/inventory/unit-actions";
import type { MediaItem } from "../lib/contracts";
import { mediaSrc, uploadMedia } from "../lib/media";

/** The photos of a unit or a project, read only: one large photo, a thumbnail strip, a calm tile when there are none. */
export function MediaGallery({
  title,
  name,
  photos,
  plan,
}: {
  title: string;
  name: string;
  photos: MediaItem[];
  /** A unit draws leasing's faint floor plan instead of the building tile when it has no photo. */
  plan?: { bedrooms: number | null };
}) {
  return (
    <Gallery
      title={title}
      photos={photos.map((p) => ({ id: p.id, src: mediaSrc(p.id), caption: p.caption }))}
      placeholder={
        plan ? (
          <PlanPlaceholder bedrooms={plan.bedrooms} label="No photos yet. Add them from Edit." />
        ) : (
          <Cover name={name} src={undefined} alt={`${title}: no photo yet`} emptyLabel="No photo yet" />
        )
      }
    />
  );
}

/** Edits the photos of a unit or a project in place (admin only; the engine checks the role again). */
export function MediaManager({
  kind,
  ownerId,
  photos,
}: {
  kind: MediaOwnerKind;
  ownerId: string;
  photos: MediaItem[];
}) {
  const owner = { kind, id: ownerId } as const;
  return (
    <PhotoManager
      photos={photos.map((p) => ({ id: p.id, src: mediaSrc(p.id), caption: p.caption }))}
      upload={uploadMedia.bind(null, kind, ownerId)}
      caption={captionMediaAction.bind(null, owner)}
      remove={removeMediaAction.bind(null, owner)}
      reorder={reorderMediaAction.bind(null, owner)}
    />
  );
}
