import { describe, expect, test } from "bun:test";
import { sniffImage, stripImageMetadata } from "../src/index.ts";
import { jpegWithExif, pngWithText } from "./fixtures.ts";

const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("stripImageMetadata", () => {
  test("JPEG: removes EXIF/GPS and comments, keeps JFIF and image data", () => {
    const src = jpegWithExif();
    const out = stripImageMetadata(src, sniffImage(src)!)!;
    expect(text(out)).not.toContain("GPSLatitude");
    expect(text(out)).not.toContain("shot by staff phone");
    expect(text(out)).toContain("JFIF");
    expect(out.slice(-6)).toEqual(src.slice(-6));
    expect(sniffImage(out)?.mime).toBe("image/jpeg");
  });
  test("JPEG: keeps the colour profile, drops other APP segments and anything after the image", () => {
    const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
    const ascii = (s: string) => [...new TextEncoder().encode(s)];
    const src = Uint8Array.from([
      0xff,
      0xd8,
      ...seg(0xe2, ascii("ICC_PROFILE")),
      ...seg(0xe5, ascii("MakerNoteSerial123")),
      ...seg(0xda, [1, 2]),
      0x10,
      0xff,
      0x00,
      0x20,
      0xff,
      0xd9,
      // trailer: a second embedded JPEG carrying its own EXIF/GPS
      0xff,
      0xd8,
      ...seg(0xe1, ascii("Exif GPSLatitude")),
      0xff,
      0xd9,
    ]);
    const out = stripImageMetadata(src, sniffImage(src)!)!;
    expect(text(out)).toContain("ICC_PROFILE");
    expect(text(out)).not.toContain("MakerNoteSerial123");
    expect(text(out)).not.toContain("GPSLatitude");
    expect(Array.from(out.subarray(-2))).toEqual([0xff, 0xd9]);
  });
  test("PNG: removes text chunks, keeps IHDR/IDAT/IEND", () => {
    const src = pngWithText();
    const out = stripImageMetadata(src, sniffImage(src)!)!;
    expect(text(out)).not.toContain("GPSLatitude");
    expect(text(out)).toContain("IHDR");
    expect(text(out)).toContain("IDAT");
    expect(text(out)).toContain("IEND");
  });
  test("WebP: drops EXIF and XMP chunks and fixes the RIFF size", () => {
    const enc = (s: string) => [...new TextEncoder().encode(s)];
    const le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
    const ch = (k: string, d: number[]) => [...enc(k), ...le(d.length), ...d, ...(d.length % 2 ? [0] : [])];
    const body = [
      ...enc("WEBP"),
      ...ch("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...ch("VP8 ", [1, 2, 3, 4]),
      ...ch("EXIF", enc("GPSLatitude")),
      ...ch("XMP ", enc("<x/>")),
    ];
    const src = Uint8Array.from([...enc("RIFF"), ...le(body.length), ...body]);
    const out = stripImageMetadata(src, sniffImage(src)!)!;
    expect(text(out)).not.toContain("GPSLatitude");
    expect(text(out)).not.toContain("XMP ");
    const size = out[4]! | (out[5]! << 8) | (out[6]! << 16) | (out[7]! << 24);
    expect(size).toBe(out.length - 8);
    expect(out[20]! & 0x0c).toBe(0); // VP8X flags cleared
  });
  test("truncated or malformed files are refused", () => {
    const src = jpegWithExif().slice(0, 12);
    expect(stripImageMetadata(src, sniffImage(src)!)).toBeNull();
    expect(
      stripImageMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x00]), { mime: "image/jpeg", ext: "jpg" }),
    ).toBeNull();
  });
});
