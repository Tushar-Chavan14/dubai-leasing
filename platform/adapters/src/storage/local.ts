import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/**
 * Content-addressed files on local disk: `<root>/<aa>/<sha256>.<ext>`. Writes go to a temp
 * file first, so a crash never leaves a half-written file under its final name.
 */
export class LocalDiskStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(bytes: Uint8Array, ext: string): Promise<{ sha256: string; path: string; bytes: number }> {
    if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error("invalid file extension");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const rel = join(sha256.slice(0, 2), `${sha256}.${ext}`);
    const full = this.resolveInside(rel);
    const exists = await stat(full).then(
      () => true,
      () => false,
    );
    if (!exists) {
      await mkdir(join(this.root, sha256.slice(0, 2)), { recursive: true });
      const tmp = `${full}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, full);
    }
    return { sha256, path: rel, bytes: bytes.byteLength };
  }

  read(rel: string): Promise<Buffer> {
    return readFile(this.resolveInside(rel));
  }

  /** Deletes a stored file; missing files are fine. */
  async remove(rel: string): Promise<void> {
    await rm(this.resolveInside(rel), { force: true });
  }

  /** Refuses paths that would escape the store root. */
  private resolveInside(rel: string): string {
    const full = resolve(this.root, rel);
    if (!full.startsWith(this.root + sep)) throw new Error("path outside the store");
    return full;
  }
}

export type ImageType = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

/** Detects JPEG, PNG or WebP from the file's magic bytes (never trusts the declared type). */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) {
    return { mime: "image/png", ext: "png" };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}
