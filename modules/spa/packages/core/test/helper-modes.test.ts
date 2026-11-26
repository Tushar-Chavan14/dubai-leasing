import { describe, expect, test } from "bun:test";
import {
  HELPER_MODES,
  isSwitchableHelper,
  NON_SWITCHABLE_HELPERS,
  scopeAllowed,
  SWITCHABLE_HELPERS,
} from "../src/index.ts";

describe("C24 helper modes (S22, S59)", () => {
  test("three modes, seven switchable helpers", () => {
    expect([...HELPER_MODES]).toEqual(["auto", "review", "off"]);
    expect([...SWITCHABLE_HELPERS]).toEqual([
      "spa_ownership_check",
      "spa_kyc",
      "spa_company_check",
      "spa_document_reader",
      "spa_prepare",
      "registry",
      "spa_agreement_review",
    ]);
  });
  test("AML screening, settlement, the chaser and collections are never switchable", () => {
    for (const h of ["aml_screening", "settlement", "chaser", "collections", "spa_aml"]) {
      expect(isSwitchableHelper(h)).toBe(false);
    }
    expect([...NON_SWITCHABLE_HELPERS]).toEqual(expect.arrayContaining(["aml_screening", "settlement"]));
    for (const h of SWITCHABLE_HELPERS) expect(isSwitchableHelper(h)).toBe(true);
  });
  test("only the document reader has scopes: its document kinds", () => {
    expect(scopeAllowed("spa_kyc", "*")).toBe(true);
    expect(scopeAllowed("spa_kyc", "noc")).toBe(false);
    expect(scopeAllowed("spa_document_reader", "*")).toBe(true);
    expect(scopeAllowed("spa_document_reader", "noc")).toBe(true);
    expect(scopeAllowed("spa_document_reader", "passport")).toBe(false);
    expect(scopeAllowed("aml_screening", "*")).toBe(false);
  });
});
