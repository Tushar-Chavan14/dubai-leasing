/**
 * Browser-side photo preparation before upload: fixes orientation, scales the long edge down to
 * 2400px and re-encodes as JPEG. Re-encoding also strips EXIF metadata such as GPS location.
 */
const MAX_EDGE = 2400;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export function checkPhotoFile(file: File): string | null {
  if (!ACCEPT.includes(file.type)) return `${file.name}: use JPEG, PNG or WebP`;
  if (file.size > MAX_SOURCE_BYTES) return `${file.name}: larger than 25 MB`;
  return null;
}

export async function preparePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This browser can't prepare photos");
  g.fillStyle = "#ffffff"; // PNG transparency → white rather than black in JPEG
  g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the photo"))), "image/jpeg", 0.86),
  );
}

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
