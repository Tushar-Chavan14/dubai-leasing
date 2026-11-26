import { preparePhoto } from "@platform/ui/media/photo-check";
export { MAX_SOURCE_BYTES, checkPhotoFile, preparePhoto } from "@platform/ui/media/photo-check";

export async function uploadPhoto(unitId: string, file: File, caption: string): Promise<{ photo: { id: string } }> {
  const blob = await preparePhoto(file);
  const form = new FormData();
  form.set("file", new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
  if (caption.trim()) form.set("caption", caption.trim());
  const res = await fetch(`/api/units/${unitId}/photos`, { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { error?: string; photo?: { id: string } };
  if (!res.ok || !body.photo) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return { photo: body.photo };
}
