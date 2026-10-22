import type { ImageType } from "./local.ts";

/**
 * Removes metadata that can identify people or places (EXIF incl. GPS, XMP, IPTC, comments,
 * text chunks) from JPEG, PNG and WebP files without re-encoding the pixels. Returns null when
 * the file's structure can't be walked safely; callers should refuse such files.
 */
export function stripImageMetadata(bytes: Uint8Array, type: ImageType): Uint8Array | null {
  try {
    if (type.ext === "jpg") return stripJpeg(bytes);
    if (type.ext === "png") return stripPng(bytes);
    return stripWebp(bytes);
  } catch {
    return null;
  }
}

/**
 * JPEG: keep only the application segments a decoder needs (APP0 JFIF, APP2 colour profile,
 * APP14 Adobe colour transform); drop the rest (EXIF/XMP, maker notes, IPTC, comments).
 * Everything after the end-of-image marker (phone "multi-picture" trailers, appended
 * thumbnails with their own EXIF) is cut off.
 */
const KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [b.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      // Start of scan. Image data runs to the first end-of-image marker (inside the data an FF
      // byte is always followed by 00 or a restart marker, so FF D9 can only be the real end).
      for (let j = i + 2; j + 1 < b.length; j++) {
        if (b[j] === 0xff && b[j + 1] === 0xd9) {
          out.push(b.subarray(i, j + 2));
          return concat(out);
        }
      }
      return null;
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) return null;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const drop = (isApp && !KEEP_APP.has(marker)) || marker === 0xfe;
    if (!drop) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

/** PNG: drop eXIf and text chunks (tEXt, iTXt, zTXt) and tIME. */
function stripPng(b: Uint8Array): Uint8Array | null {
  const DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const kind = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!DROP.has(kind)) out.push(b.subarray(i, end));
    i = end;
    if (kind === "IEND") return concat(out);
  }
  return null;
}

/** WebP (RIFF): drop EXIF and XMP chunks, clear their VP8X flags and fix the RIFF size. */
function stripWebp(b: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const kind = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
    const len = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > b.length) return null;
    if (kind === "VP8X") {
      const chunk = b.slice(i, Math.min(end, b.length));
      chunk[8] = chunk[8]! & ~0x0c; // clear EXIF (0x08) and XMP (0x04) flags
      out.push(chunk);
    } else if (kind !== "EXIF" && kind !== "XMP ") {
      out.push(b.subarray(i, Math.min(end, b.length)));
    }
    i = end;
  }
  const body = concat(out);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  const size = body.length + 4;
  header[4] = size & 0xff;
  header[5] = (size >> 8) & 0xff;
  header[6] = (size >> 16) & 0xff;
  header[7] = (size >> 24) & 0xff;
  return concat([header, body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
