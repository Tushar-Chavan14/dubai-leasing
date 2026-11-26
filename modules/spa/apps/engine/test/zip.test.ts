import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, readZip, writeZip } from "../src/manager/zip.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("the store-only ZIP writer (C23, S62)", () => {
  test("crc32 matches the standard check value", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  test("writes entries that read back byte for byte, in the order given", () => {
    const files = [
      { name: "a.txt", bytes: enc("hello") },
      { name: "dir/b.bin", bytes: new Uint8Array([0, 1, 2, 255]) },
      { name: "empty", bytes: new Uint8Array() },
    ];
    const zip = writeZip(files);
    const back = readZip(zip);
    expect(back.map((f) => f.name)).toEqual(["a.txt", "dir/b.bin", "empty"]);
    expect([...back[1]!.bytes]).toEqual([0, 1, 2, 255]);
    expect(back.every((f) => f.crcOk)).toBe(true);
  });
  test("the same files give the same bytes", () => {
    const f = [{ name: "a", bytes: enc("x") }];
    expect(Buffer.from(writeZip(f)).equals(Buffer.from(writeZip(f)))).toBe(true);
  });
  test("refuses a name that could escape a folder or is a duplicate", () => {
    expect(() => writeZip([{ name: "../x", bytes: enc("") }])).toThrow(/name/);
    expect(() => writeZip([{ name: "/x", bytes: enc("") }])).toThrow(/name/);
    expect(() => writeZip([{ name: "a\\b", bytes: enc("") }])).toThrow(/name/);
    expect(() =>
      writeZip([
        { name: "a", bytes: enc("") },
        { name: "a", bytes: enc("") },
      ]),
    ).toThrow(/twice/);
  });
  test("the system unzip accepts it", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    try {
      const p = join(dir, "t.zip");
      writeFileSync(p, writeZip([{ name: "a.txt", bytes: enc("hello") }]));
      const r = Bun.spawnSync(["unzip", "-t", p]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain("No errors detected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
