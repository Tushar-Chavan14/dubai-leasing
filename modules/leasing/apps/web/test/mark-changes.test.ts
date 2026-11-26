import { describe, expect, test } from "bun:test";
import {
  type Mark,
  type MarkDraft,
  marksKey,
  marksReducer,
  dedupeRects,
  normaliseQuote,
  parseStoredMarks,
  rectsRelativeTo,
  sendLabel,
  spaceAfter,
} from "../lib/mark-changes.ts";

const draft = (id: string, note = "n"): MarkDraft => ({ id, page: 1, quote: `q${id}`, note, label: null, rects: [] });
const three = (): Mark[] =>
  ["a", "b", "c"].reduce<Mark[]>((s, id) => marksReducer(s, { type: "add", mark: draft(id) }), []);

describe("marksReducer", () => {
  test("add numbers from 1", () => {
    expect(three().map((m) => [m.id, m.n])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });
  test("edit changes only the note", () => {
    const s = marksReducer(three(), { type: "edit", id: "b", note: "new" });
    expect(s[1]).toMatchObject({ id: "b", n: 2, note: "new", quote: "qb" });
    expect(s[0]!.note).toBe("n");
  });
  test("remove renumbers the rest", () => {
    const s = marksReducer(three(), { type: "remove", id: "a" });
    expect(s.map((m) => [m.id, m.n])).toEqual([
      ["b", 1],
      ["c", 2],
    ]);
  });
  test("remove of an unknown id changes nothing", () => {
    expect(marksReducer(three(), { type: "remove", id: "zz" })).toHaveLength(3);
  });
  test("load renumbers and clear empties", () => {
    const loaded = marksReducer([], { type: "load", marks: [{ ...three()[2]!, n: 9 }] });
    expect(loaded[0]!.n).toBe(1);
    expect(marksReducer(loaded, { type: "clear" })).toEqual([]);
  });
});

describe("storage helpers", () => {
  test("key is per token", () => expect(marksKey("abc")).toBe("marks:abc"));
  test("parseStoredMarks survives junk", () => {
    expect(parseStoredMarks(null)).toEqual([]);
    expect(parseStoredMarks("{")).toEqual([]);
    expect(parseStoredMarks('{"a":1}')).toEqual([]);
    expect(parseStoredMarks(JSON.stringify([{ id: 1 }, three()[0]]))).toHaveLength(1);
  });
  test("round trip", () => {
    const m = three();
    expect(parseStoredMarks(JSON.stringify(m))).toEqual(m);
  });
});

describe("labels and geometry", () => {
  test("sendLabel", () => {
    expect(sendLabel(1)).toBe("Send 1 change");
    expect(sendLabel(2)).toBe("Send 2 changes");
    expect(sendLabel(10)).toBe("Send 10 changes");
  });
  test("normaliseQuote", () => expect(normaliseQuote("  a \n  b\t c ")).toBe("a b c"));
  test("rectsRelativeTo scales to the page box and drops slivers", () => {
    const r = rectsRelativeTo(
      [
        { left: 110, top: 220, width: 50, height: 10 },
        { left: 0, top: 0, width: 0, height: 10 },
      ],
      { left: 10, top: 20, width: 200, height: 400 },
    );
    expect(r).toEqual([{ x: 0.5, y: 0.5, w: 0.25, h: 0.025 }]);
  });
});

describe("dedupeRects", () => {
  test("keeps one of equal boxes and drops boxes inside another", () => {
    const big = { x: 0.1, y: 0.1, w: 0.5, h: 0.02 };
    const out = dedupeRects([
      big,
      { ...big },
      { x: 0.2, y: 0.1, w: 0.1, h: 0.02 },
      { x: 0.1, y: 0.3, w: 0.2, h: 0.02 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.some((r) => r.w === 0.5)).toBe(true);
  });
});

describe("spaceAfter", () => {
  const it = (x: number, y = 0) => ({ x, y, w: 40, h: 20 });
  test("touching items get no space, a gap or a new line does", () => {
    expect(spaceAfter([it(0), it(40)], 0)).toBe(false);
    expect(spaceAfter([it(0), it(43)], 0)).toBe(false);
    expect(spaceAfter([it(0), it(50)], 0)).toBe(true);
    expect(spaceAfter([it(0), it(0, 30)], 0)).toBe(true);
    expect(spaceAfter([it(0)], 0)).toBe(false);
  });
});
