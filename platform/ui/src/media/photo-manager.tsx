"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Banner } from "../form";
import { moveItem, type PhotoItem, PhotoPicker } from "./photo-picker";

type Saved = { ok?: boolean; error?: string | undefined };

/**
 * Edits saved photos in place: every change is saved as it happens. The caller supplies the engine calls, already
 * bound to its record: pass server actions (imported in a server or client file), never inline closures over them
 * that capture state.
 */
export function PhotoManager({
  photos,
  upload,
  caption: saveCaption,
  remove: removePhoto,
  reorder,
}: {
  photos: { id: string; src: string; caption: string | null }[];
  upload: (file: File, caption: string) => Promise<{ photo: { id: string } }>;
  caption: (id: string, caption: string) => Promise<Saved>;
  remove: (id: string) => Promise<Saved>;
  reorder: (ids: string[]) => Promise<Saved>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PhotoItem[]>(() =>
    photos.map((p) => ({
      key: p.id,
      id: p.id,
      src: p.src,
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
        const { photo } = await upload(p.file, "");
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
    const r = await removePhoto(p.id);
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
    const r = await reorder(ids);
    if (!r.ok) {
      setError(r.error ?? "Couldn't save the new order.");
      setItems(items);
    }
    router.refresh();
  }

  async function commitCaption(key: string) {
    const p = items.find((x) => x.key === key);
    if (!p?.id || savedCaptions.current.get(p.id) === p.caption) return;
    const r = await saveCaption(p.id, p.caption);
    if (r.ok) savedCaptions.current.set(p.id, p.caption);
    else setError(r.error ?? "Couldn't save the caption.");
  }

  return (
    <div className="grid gap-3">
      {error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          {error}
        </Banner>
      )}
      <PhotoPicker
        items={items}
        onAdd={add}
        onRemove={remove}
        onMove={move}
        onCaption={(key, caption) => patch(key, { caption })}
        onCaptionCommit={commitCaption}
      />
      <p className="m-0 text-[13px] text-muted" role="status">
        {busy ? "Uploading…" : "Changes to photos are saved as you make them."}
      </p>
    </div>
  );
}
