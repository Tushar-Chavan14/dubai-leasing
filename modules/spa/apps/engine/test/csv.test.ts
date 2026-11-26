import { describe, expect, test } from "bun:test";
import { csvCell, csvLine } from "../src/manager/csv.ts";

describe("CSV cells (C23, S62)", () => {
  test("a cell starting with = + - @ tab or CR is made text with a leading apostrophe", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("\tx")).toBe("'\tx");
  });
  test("plain text and numbers are left alone; quotes, commas and newlines are quoted", () => {
    expect(csvCell("abc")).toBe("abc");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("=a,b")).toBe(`"'=a,b"`);
  });
  test("a line ends with CRLF", () => {
    expect(csvLine(["a", 1, null])).toBe("a,1,\r\n");
  });
});
