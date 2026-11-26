import { expect, test } from "bun:test";
import { KYC_GOLDEN, kycGoldenCases } from "./kyc-golden-cases.ts";

// S49 (C17): the KYC reader moved to platform/readers; leasing's results and prompts stay byte-identical.
test("leasing KYC checks, rules and prompts on the specimen cases match the recorded golden", async () => {
  const golden = (await Bun.file(KYC_GOLDEN).json()) as unknown;
  expect(await kycGoldenCases()).toEqual(golden);
});
