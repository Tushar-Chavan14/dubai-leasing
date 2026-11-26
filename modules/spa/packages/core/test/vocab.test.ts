import { describe, expect, test } from "bun:test";
import {
  CHASE_REASONS,
  DEAL_STATES,
  PARTY_BANNED_PATTERN,
  PARTY_GLOSSARY,
  PARTY_STATE_WORDS,
  partyBanned,
  type StepKey,
} from "../src/index.ts";

describe("party vocabulary (C26, S61)", () => {
  test("every deal state has party words, and a compliance hold reads Under review", () => {
    expect(Object.keys(PARTY_STATE_WORDS).sort()).toEqual([...DEAL_STATES].sort());
    expect(PARTY_STATE_WORDS.AML_HOLD).toBe("Under review");
  });

  test("no party word, reason or glossary line holds a banned word", () => {
    const steps: StepKey[] = [
      "offer",
      "parties",
      "agreement",
      "legal",
      "signing",
      "noc",
      "finance",
      "settlement",
      "registration",
      "transfer",
      "instalments",
    ];
    expect(Object.keys(PARTY_GLOSSARY).sort()).toEqual([...steps].sort());
    for (const w of [...Object.values(PARTY_STATE_WORDS), ...Object.values(PARTY_GLOSSARY)])
      expect([w, partyBanned(w)]).toEqual([w, false]);
  });

  test("every fixed chase reason a party can be shown is free of banned words", () => {
    for (const w of Object.values(CHASE_REASONS)) expect([w, partyBanned(w)]).toEqual([w, false]);
  });

  test("banned words are caught in any case, inflection and Arabic-free punctuation", () => {
    for (const t of [
      "AML",
      "an aml check",
      "Sanctions list",
      "sanctioned",
      "the screening",
      "screened",
      "PEP",
      "peps",
      "EDD",
      "high risk",
      "risks",
      "flagged",
      "a flag",
      "SAR report",
      "reported",
      "Compliance review",
      "money-laundering",
      "laundering",
      "Suspicious activity",
    ])
      expect([t, partyBanned(t)]).toEqual([t, true]);
    for (const t of ["Your agent can help", "Checking parties", "the pepper", "edding", "Under review"])
      expect([t, partyBanned(t)]).toEqual([t, false]);
    expect(PARTY_BANNED_PATTERN.test("")).toBe(false);
  });
});
