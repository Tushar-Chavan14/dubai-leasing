"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { captionPhotoAction, deletePhotoAction, reorderPhotosAction } from "../app/(staff)/units/actions";
import { uploadPhoto } from "../lib/images";
import { IconWarning } from "../lib/icons";
import type { UnitPhoto } from "../lib/types";
import { moveItem, type PhotoItem, PhotoPicker } from "./photo-picker";

/** Edits a saved unit's photos in place: every change is saved as it happens. */
export function PhotoManager({ unitId, photos }: { unitId: string; photos: UnitPhoto[] }) {
  const router = useRouter();
  const [items, setItems] = useState<PhotoItem[]>(() =>
    photos.map((p) => ({
      key: p.id,
      id: p.id,
      src: `/media/units/${unitId}/${p.id}`,
      caption: p.caption ?? "",
      status: "saved",
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const savedCaptions = useRef(new Map(photos.map((p) => [p.id, p.caption ?? ""])));
  const busy = items.some((p) => p.status === "uploading" || p.status === "queued");

  const patch = (key: string, change: Partial<PhotoItem>) =>
    setItems((l) => l.map((p) => (p.key === key ? { ...p, ...change } : p)));

  async function add(files: File[]) {
    setError(null);
    const fresh = files.map((f) => ({
      key: `new-${crypto.randomUUID()}`,
      src: URL.createObjectURL(f),
      caption: "",
      file: f,
      status: "queued" as const,
    }));
    setItems((l) => [...l, ...fresh]);
    for (const p of fresh) {
      patch(p.key, { status: "uploading" });
      try {
        const { photo } = await uploadPhoto(unitId, p.file, "");
        savedCaptions.current.set(photo.id, "");
        patch(p.key, { status: "saved", id: photo.id });
      } catch (e) {
        patch(p.key, { status: "error", error: (e as Error).message });
      }
    }
    router.refresh();
  }

  async function remove(key: string) {
    const p = items.find((x) => x.key === key);
    setItems((l) => l.filter((x) => x.key !== key));
    if (!p?.id) return;
    const r = await deletePhotoAction(unitId, p.id);
    if (!r.ok) {
      setError(r.error ?? "Couldn't remove the photo.");
      setItems((l) => [...l, p]);
    }
    router.refresh();
  }

  async function move(key: string, to: number) {
    const from = items.findIndex((x) => x.key === key);
    const next = moveItem(items, from, to);
    setItems(next);
    const ids = next.map((x) => x.id).filter((x): x is string => !!x);
    if (ids.length !== next.length) return; // wait for uploads to finish before saving order
    const r = await reorderPhotosAction(unitId, ids);
    if (!r.ok) {
      setError(r.error ?? "Couldn't save the new order.");
      setItems(items);
    }
    router.refresh();
  }

  async function commitCaption(key: string) {
    const p = items.find((x) => x.key === key);
    if (!p?.id || savedCaptions.current.get(p.id) === p.caption) return;
    const r = await captionPhotoAction(unitId, p.id, p.caption);
    if (r.ok) savedCaptions.current.set(p.id, p.caption);
    else setError(r.error ?? "Couldn't save the caption.");
  }

  return (
    <div>
      {error && (
        <div className="alert" data-tone="bad" role="alert" style={{ marginBottom: 12 }}>
          <IconWarning size={16} />
          {error}
        </div>
      )}
      <PhotoPicker
        items={items}
        onAdd={add}
        onRemove={remove}
        onMove={move}
        onCaption={(key, caption) => patch(key, { caption })}
        onCaptionCommit={commitCaption}
      />
      <p className="hint" style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }} role="status">
        {busy ? "Uploading…" : "Changes to photos are saved as you make them."}
      </p>
    </div>
  );
}
