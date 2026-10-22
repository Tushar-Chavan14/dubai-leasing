"use client";

import { useId, useRef, useState } from "react";
import { checkPhotoFile } from "../lib/images";
import { IconChevronLeft, IconChevronRight, IconImage, IconStar, IconTrash } from "../lib/icons";

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

  return (
    <div>
      <label
        htmlFor={inputId}
        className="dropzone"
        data-over={over}
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
        <IconImage size={22} />
        <span>
          <strong>Add photos</strong> or drop them here
        </span>
        <span style={{ fontSize: 13 }}>
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
        <p className="err" role="alert" style={{ color: "var(--bad)", fontSize: 13, marginTop: 8 }}>
          {rejected.join(". ")}
        </p>
      )}
      {items.length > 0 && (
        <ol className="photo-grid" style={{ listStyle: "none", padding: 0 }} aria-label="Photos, in listing order">
          {items.map((p, i) => (
            <li
              key={p.key}
              className="photo-tile"
              data-busy={p.status === "uploading" || p.status === "queued"}
              data-error={p.status === "error"}
            >
              <div className="img">
                {/* Previews are local object URLs or the authenticated media route. */}
                <img src={p.src} alt={p.caption || `Photo ${i + 1}`} />
                {i === 0 && <span className="cover-tag">Cover</span>}
                {p.status && p.status !== "saved" && (
                  <span className="state">
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
              />
              <div className="tools">
                <span className="btn-row" style={{ gap: 2 }}>
                  <button
                    type="button"
                    className="btn ghost icon"
                    title="Move earlier"
                    aria-label={`Move photo ${i + 1} earlier`}
                    disabled={disabled || i === 0}
                    onClick={() => onMove(p.key, i - 1)}
                  >
                    <IconChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn ghost icon"
                    title="Move later"
                    aria-label={`Move photo ${i + 1} later`}
                    disabled={disabled || i === items.length - 1}
                    onClick={() => onMove(p.key, i + 1)}
                  >
                    <IconChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn ghost icon"
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
                  className="btn ghost icon"
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
