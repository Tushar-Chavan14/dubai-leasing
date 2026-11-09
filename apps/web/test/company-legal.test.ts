import { describe, expect, test } from "bun:test";
import { legalBody, showsIdNumber, validateCompanyCreate, validateCompanyLegal } from "../lib/company-legal";

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
  test("the browser check names every missing or malformed field, with the engine's messages", () => {
    const f = new FormData();
    f.set("name", " ");
    f.set("kind", "realty");
    f.set("email", "not-an-email");
    f.set("signatoryIdKind", "emirates_id");
    f.set("signatoryIdNo", "12345");
    const e = validateCompanyCreate(f)!;
    expect(e.name).toBe("Enter the company name");
    expect(e.legalNameEn).toBe("Required");
    expect(e.tradeLicenceExpiresOn).toBe("Required");
    expect(e.email).toBe("Enter an email like name@company.ae");
    expect(e.signatoryEmail).toBe("Required");
    expect(e.signatoryIdNo).toBe("Use the format 784-YYYY-NNNNNNN-N");
    expect(e.reraOrn).toBeUndefined();
  });
  test("a complete record passes the browser check", () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({
      legalNameEn: "Silverline L.L.C.",
      tradeLicenceNo: "TL-1",
      tradeLicenceAuthority: "DET",
      tradeLicenceExpiresOn: "2030-01-31",
      registeredAddress: "Office 1, Dubai",
      email: "legal@silverline.ae",
      signatoryName: "A. Person",
      signatoryTitle: "Director",
      signatoryEmail: "a@silverline.ae",
      signatoryIdKind: "passport",
      signatoryIdNo: "N1234567",
    }))
      f.set(k, v);
    expect(validateCompanyLegal(f)).toBeNull();
  });
});
