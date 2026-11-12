import { describe, expect, test } from "bun:test";
import {
  Emirate,
  EMIRATES,
  EMIRATE_LABELS,
  registrationStageName,
  registrationSystemName,
  rentIndexName,
} from "../src/index.ts";

describe("emirates", () => {
  test("seven emirates, each with a label and registration system", () => {
    expect(EMIRATES).toHaveLength(7);
    for (const e of EMIRATES) {
      expect(EMIRATE_LABELS[e].length).toBeGreaterThan(0);
      expect(registrationSystemName(e).length).toBeGreaterThan(0);
    }
  });
  test("names", () => {
    expect(EMIRATE_LABELS.ras_al_khaimah).toBe("Ras Al Khaimah");
    expect(registrationSystemName("dubai")).toBe("Ejari");
    expect(registrationSystemName("abu_dhabi")).toBe("Tawtheeq");
    expect(registrationSystemName("ajman")).toBe("Tasdeeq");
    expect(registrationSystemName("fujairah")).toBe("Ejaar");
    expect(registrationSystemName("sharjah")).toBe("Sharjah Municipality attestation");
    expect(registrationSystemName("ras_al_khaimah")).toBe("RAK Municipality attestation");
    expect(registrationSystemName("umm_al_quwain")).toBe("UAQ Municipality attestation");
  });
  test("rent index name", () => {
    expect(rentIndexName("dubai")).toBe("Smart Rental Index");
    expect(rentIndexName("sharjah")).toBe("Rent index");
  });
  test("schema rejects unknown", () => {
    expect(Emirate.safeParse("doha").success).toBe(false);
    expect(Emirate.parse("abu_dhabi")).toBe("abu_dhabi");
  });
});

describe("registration stage name", () => {
  test("one word per emirate, never Ejari outside Dubai", () => {
    expect(registrationStageName("dubai")).toBe("Ejari");
    expect(registrationStageName("abu_dhabi")).toBe("Tawtheeq");
    expect(registrationStageName("ajman")).toBe("Tasdeeq");
    expect(registrationStageName("fujairah")).toBe("Ejaar");
    for (const e of ["sharjah", "ras_al_khaimah", "umm_al_quwain"] as const)
      expect(registrationStageName(e)).toBe("Attestation");
  });
});
