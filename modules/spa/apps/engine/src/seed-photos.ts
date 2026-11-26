import { deflateSync } from "node:zlib";

/**
 * Placeholder photos for the demo (S78): drawn in code, a soft sky-to-ground gradient with a few simple towers.
 * No stock photos, no people, no logos. `seed` changes the hue and the skyline, so two photos never share bytes.
 */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const hsl = (h: number, s: number, l: number): [number, number, number] => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
};

export function placeholderPhoto(seed: number, width = 640, height = 400): Uint8Array {
  const hue = (seed * 47) % 360;
  const [r1, g1, b1] = hsl(hue, 0.45, 0.82);
  const [r2, g2, b2] = hsl((hue + 30) % 360, 0.35, 0.62);
  const [tr, tg, tb] = hsl((hue + 200) % 360, 0.25, 0.32);
  // Towers: deterministic from the seed.
  const towers = Array.from({ length: 6 }, (_, i) => ({
    x: Math.round(((i * 97 + seed * 31) % 560) + 20),
    w: 40 + ((seed * 13 + i * 29) % 50),
    h: 120 + ((seed * 17 + i * 61) % 170),
  }));
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    const t = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const tower = towers.some((q) => x >= q.x && x < q.x + q.w && y >= height - q.h);
      const o = row + 1 + x * 3;
      raw[o] = tower ? tr : Math.round(r1 + (r2 - r1) * t);
      raw[o + 1] = tower ? tg : Math.round(g1 + (g2 - g1) * t);
      raw[o + 2] = tower ? tb : Math.round(b1 + (b2 - b1) * t);
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
