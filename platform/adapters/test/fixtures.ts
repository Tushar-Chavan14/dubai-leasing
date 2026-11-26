/** Hand-built image files with metadata segments, for strip and upload tests. */
const enc = (s: string) => new TextEncoder().encode(s);
const join = (...parts: (Uint8Array | number[])[]) => {
  const flat = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(flat.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of flat) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const seg = (marker: number, body: Uint8Array) =>
  join([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], body);

/** JPEG: SOI, APP0 (JFIF), APP1 (EXIF with a GPS marker string), COM, SOS + data, EOI. */
export function jpegWithExif(seed = 0): Uint8Array {
  return join(
    [0xff, 0xd8],
    seg(0xe0, join(enc("JFIF"), [0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    seg(0xe1, join(enc("Exif"), [0, 0], enc("GPSLatitude 25.0800N"))),
    seg(0xfe, enc("shot by staff phone")),
    seg(0xda, Uint8Array.from([1, 2, 3])),
    [0x11, 0x22, 0x33, seed, 0xff, 0xd9],
  );
}

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const chunk = (kind: string, data: Uint8Array) => join(be32(data.length), enc(kind), data, [0, 0, 0, 0]);

/** PNG: signature, IHDR, tEXt (GPS comment), IDAT, IEND. CRCs are zero; only structure matters here. */
export function pngWithText(): Uint8Array {
  return join(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    chunk("tEXt", enc("Comment\0GPSLatitude 25.0800N")),
    chunk("IDAT", Uint8Array.from([1, 2, 3, 4])),
    chunk("IEND", new Uint8Array()),
  );
}
