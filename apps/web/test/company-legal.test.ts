import { describe, expect, test } from "bun:test";
import { legalBody, showsIdNumber } from "../lib/company-legal";

describe("company legal form", () => {
  test("blank fields become null, text is trimmed", () => {
    const f = new FormData();
    f.set("legalNameEn", "  Silverline L.L.C.  ");
    f.set("reraOrn", "   ");
    const body = legalBody(f);
    expect(body.legalNameEn).toBe("Silverline L.L.C.");
    expect(body.reraOrn).toBeNull();
    expect(body.signatoryIdNo).toBeNull();
  });
  test("ID numbers are shown to leasing roles and admins only", () => {
    expect(showsIdNumber("admin")).toBe(true);
    expect(showsIdNumber("leasing_officer")).toBe(true);
    expect(showsIdNumber("finance")).toBe(false);
    expect(showsIdNumber(undefined)).toBe(false);
  });
});
