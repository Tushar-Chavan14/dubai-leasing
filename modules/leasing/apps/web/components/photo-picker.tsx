"use client";

import { useId, useRef, useState } from "react";
import { checkPhotoFile } from "../lib/images";
import {
  CaretLeftIcon as IconChevronLeft,
  CaretRightIcon as IconChevronRight,
  ImageIcon as IconImage,
  StarIcon as IconStar,
  TrashIcon as IconTrash,
} from "@phosphor-icons/react";

export interface PhotoItem {
  key: string;
  /** Object URL for a new file, or the media route for a saved photo. */
  src: string;
  caption: string;
  file?: File;
  /** Saved photo id (edit mode). */
  id?: string;
  status?: "queued" | "uploading" | "saved" | "error";
  error?: string;
}

interface Props {
  items: PhotoItem[];
  onAdd(files: File[]): void;
  onRemove(key: string): void;
  onMove(key: string, to: number): void;
  onCaption(key: string, caption: string): void;
  onCaptionCommit?(key: string): void;
  disabled?: boolean;
  max?: number;
}

/** Drop zone plus a reorderable grid. The first photo is the cover on listings. */
export function PhotoPicker({ items, onAdd, onRemove, onMove, onCaption, onCaptionCommit, disabled, max = 24 }: Props) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  function take(list: FileList | null) {
    if (!list) return;
    const files = [...list];
    const bad = files.map(checkPhotoFile).filter((x): x is string => !!x);
    const good = files.filter((f) => !checkPhotoFile(f)).slice(0, Math.max(0, max - items.length));
    if (files.length - bad.length > good.length) bad.push(`Only ${max} photos per unit`);
    setRejected(bad);
    if (good.length) onAdd(good);
  }

  const TOOL =
    "grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-ink hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ink";
  return (
    <div className="grid gap-3">
      <label
        htmlFor={inputId}
        data-over={over}
        className="grid cursor-pointer justify-items-center gap-1 rounded-2xl border border-dashed border-line px-4 py-6 text-center font-sans text-sm text-muted hover:border-ink data-[over=true]:border-ink data-[over=true]:bg-raised has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
      >
        <IconImage size={22} aria-hidden />
        <span>
          <strong className="text-ink">Add photos</strong> or drop them here
        </span>
        <span className="text-[12.5px]">
          JPEG, PNG or WebP. Resized to 2400px and stripped of location data before upload.
        </span>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          disabled={disabled || items.length >= max}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {rejected.length > 0 && (
        <p className="m-0 text-[13px] text-danger" role="alert">
          {rejected.join(". ")}
        </p>
      )}
      {items.length > 0 && (
        <ol
          className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 p-0"
          aria-label="Photos, in listing order"
        >
          {items.map((p, i) => (
            <li
              key={p.key}
              data-busy={p.status === "uploading" || p.status === "queued"}
              data-error={p.status === "error"}
              className="grid gap-2 rounded-2xl border border-line bg-page p-2 data-[error=true]:border-danger"
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-raised">
                {/* Previews are local object URLs or the authenticated media route. */}
                <img
                  src={p.src}
                  alt={p.caption || `Photo ${i + 1}`}
                  className={`block h-full w-full object-cover ${p.status === "uploading" || p.status === "queued" ? "opacity-50" : ""}`}
                />
                {i === 0 && (
                  <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 font-sans text-[11px] font-semibold text-on-accent">
                    Cover
                  </span>
                )}
                {p.status && p.status !== "saved" && (
                  <span
                    className={`absolute inset-x-2 bottom-2 rounded-full bg-page/90 px-2 py-0.5 text-center font-sans text-xs ${p.status === "error" ? "text-danger" : "text-ink"}`}
                  >
                    {p.status === "queued"
                      ? "Waiting"
                      : p.status === "uploading"
                        ? "Uploading…"
                        : (p.error ?? "Failed")}
                  </span>
                )}
              </div>
              <input
                aria-label={`Caption for photo ${i + 1}`}
                placeholder="Caption, e.g. Living room"
                value={p.caption}
                maxLength={140}
                disabled={disabled}
                onChange={(e) => onCaption(p.key, e.target.value)}
                onBlur={() => onCaptionCommit?.(p.key)}
                className="w-full rounded-input border border-line bg-page px-2.5 py-1.5 font-sans text-[13px] text-ink placeholder:text-muted hover:border-ink focus:border-ink"
              />
              <div className="flex items-center justify-between">
                <span className="flex gap-0.5">
                  <button
                    type="button"
                    className={TOOL}
                    title="Move earlier"
                    aria-label={`Move photo ${i + 1} earlier`}
                    disabled={disabled || i === 0}
                    onClick={() => onMove(p.key, i - 1)}
                  >
                    <IconChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className={TOOL}
                    title="Move later"
                    aria-label={`Move photo ${i + 1} later`}
                    disabled={disabled || i === items.length - 1}
                    onClick={() => onMove(p.key, i + 1)}
                  >
                    <IconChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    className={TOOL}
                    title="Make cover"
                    aria-label={`Make photo ${i + 1} the cover`}
                    disabled={disabled || i === 0}
                    onClick={() => onMove(p.key, 0)}
                  >
                    <IconStar size={16} />
                  </button>
                </span>
                <button
                  type="button"
                  className={TOOL}
                  title="Remove"
                  aria-label={`Remove photo ${i + 1}`}
                  disabled={disabled}
                  onClick={() => onRemove(p.key)}
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [it] = next.splice(from, 1);
  if (it === undefined) return list;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
  return next;
}
