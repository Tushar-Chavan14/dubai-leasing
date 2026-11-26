"use client";

import { PhotoManager as PlatformPhotoManager } from "@platform/ui/media/photo-manager";
import { captionPhotoAction, deletePhotoAction, reorderPhotosAction } from "../app/(staff)/units/actions";
import { uploadPhoto } from "../lib/images";
import type { UnitPhoto } from "../lib/types";

/** Edits a saved unit's photos in place: every change is saved as it happens. Binds leasing's unit actions. */
export function PhotoManager({ unitId, photos }: { unitId: string; photos: UnitPhoto[] }) {
  return (
    <PlatformPhotoManager
      photos={photos.map((p) => ({ id: p.id, src: `/media/units/${unitId}/${p.id}`, caption: p.caption }))}
      upload={uploadPhoto.bind(null, unitId)}
      caption={captionPhotoAction.bind(null, unitId)}
      remove={deletePhotoAction.bind(null, unitId)}
      reorder={reorderPhotosAction.bind(null, unitId)}
    />
  );
}
