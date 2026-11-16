import { describe, expect, test } from "bun:test";
import { ContractFees, DEMO_CONTRACT_FEES, feesFor, parseContractFees, registrationFeeFor } from "../src/index.ts";

const fee = (over: Record<string, unknown>) => ({
  id: "x",
  name: "Fee",
  kind: "other",
  amountFils: 100,
  payer: "tenant",
  emirates: [],
  ...over,
});

describe("contract fees", () => {
  test("the demo fees are valid", () => {
    expect(ContractFees.safeParse(DEMO_CONTRACT_FEES).success).toBe(true);
  });
  test("bounds and shape", () => {
    expect(ContractFees.safeParse([fee({})]).success).toBe(true);
    for (const bad of [
      { amountFils: -1 },
      { amountFils: 100_000_001 },
      { amountFils: 1.5 },
      { name: "" },
      { name: "x".repeat(81) },
      { payer: "agent" },
      { kind: "tax" },
      { emirates: ["mars"] },
      { id: "has space" },
      { name: "الرسوم" },
    ])
      expect(ContractFees.safeParse([fee(bad)]).success).toBe(false);
    expect(ContractFees.safeParse([fee({ id: "a" }), fee({ id: "a" })]).success).toBe(false);
    expect(ContractFees.safeParse(Array.from({ length: 21 }, (_, i) => fee({ id: `f${i}` }))).success).toBe(false);
  });
  test("a fee naming the emirate beats an any-emirate one; none of the other emirates' fees apply", () => {
    const fees = ContractFees.parse([
      fee({ id: "any", name: "Any", kind: "registration", amountFils: 1 }),
      fee({ id: "dxb", name: "Ejari", kind: "registration", amountFils: 2, emirates: ["dubai"] }),
      fee({ id: "ad", name: "Tawtheeq", kind: "registration", amountFils: 3, emirates: ["abu_dhabi"] }),
    ]);
    expect(registrationFeeFor(fees, "dubai")?.id).toBe("dxb");
    expect(registrationFeeFor(fees, "abu_dhabi")?.id).toBe("ad");
    expect(registrationFeeFor(fees, "sharjah")?.id).toBe("any");
    expect(registrationFeeFor(fees, null)?.id).toBe("any");
    expect(feesFor(fees, "dubai").map((f) => f.id)).toEqual(["any", "dxb"]);
    expect(registrationFeeFor([], "dubai")).toBeNull();
    expect(registrationFeeFor(null, "dubai")).toBeNull();
  });
  test("an invalid stored value reads as none", () => {
    expect(parseContractFees([{ nope: 1 }])).toEqual([]);
    expect(parseContractFees(null)).toEqual([]);
  });
});
