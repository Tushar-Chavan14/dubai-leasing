import { preparePhoto } from "@platform/ui/media/photo-check";
import type { MediaOwnerKind } from "@spa/core";

/** The URL a photo is shown from: the staff media route, never a file path. */
export const mediaSrc = (id: string): string => `/media/${id}`;

/** Browser side: resizes the photo, then posts it to the staff media route. */
export async function uploadMedia(
  kind: MediaOwnerKind,
  ownerId: string,
  file: File,
  caption: string,
): Promise<{ photo: { id: string } }> {
  const blob = await preparePhoto(file);
  const form = new FormData();
  form.set("kind", kind);
  form.set("id", ownerId);
  form.set("file", new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
  if (caption.trim()) form.set("caption", caption.trim());
  const res = await fetch("/media", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { error?: string; photo?: { id: string } };
  if (!res.ok || !body.photo) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return { photo: body.photo };
}
