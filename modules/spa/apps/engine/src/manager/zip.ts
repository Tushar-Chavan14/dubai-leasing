/**
 * A small store-only ZIP writer (C23, S62), so the case export pack needs no new dependency. No compression, no
 * ZIP64, UTF-8 names, and a fixed 1980-01-01 timestamp so the same files always give the same bytes.
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string;
  bytes: Uint8Array;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const MAX = 0xffffffff;

export function writeZip(files: readonly ZipFile[]): Uint8Array {
  const seen = new Set<string>();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  if (files.length > 0xffff) throw new Error("too many files for a ZIP without ZIP64");
  for (const f of files) {
    if (
      !f.name ||
      f.name.startsWith("/") ||
      f.name.includes("\\") ||
      f.name.split("/").some((p) => p === ".." || p === "")
    )
      throw new Error(`zip: bad file name "${f.name}"`);
    if (seen.has(f.name)) throw new Error(`zip: "${f.name}" is in the pack twice`);
    seen.add(f.name);
    if (f.bytes.byteLength > MAX) throw new Error("zip: a file is too large for a ZIP without ZIP64");
    const name = new TextEncoder().encode(f.name);
    const crc = crc32(f.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.bytes.byteLength, true);
    local.setUint32(22, f.bytes.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    local.setUint16(28, 0, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, DOS_TIME, true);
    cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.bytes.byteLength, true);
    cd.setUint32(24, f.bytes.byteLength, true);
    cd.setUint16(28, name.byteLength, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    parts.push(new Uint8Array(local.buffer), name, f.bytes);
    offset += 30 + name.byteLength + f.bytes.byteLength;
    if (offset > MAX) throw new Error("zip: the pack is too large for a ZIP without ZIP64");
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Reads a ZIP this writer made (stored entries only): used by tests and by the export check. */
export function readZip(zip: Uint8Array): { name: string; bytes: Uint8Array; crcOk: boolean }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.byteLength - 22;
  if (eocd < 0 || v.getUint32(eocd, true) !== 0x06054b50) throw new Error("zip: no end record");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; bytes: Uint8Array; crcOk: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("zip: bad central entry");
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const bytes = zip.slice(dataAt, dataAt + size);
    out.push({ name, bytes, crcOk: crc32(bytes) === crc });
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}
