import { expect, test } from "bun:test";
import { linkProblem, signError, uploadError } from "../lib/buyer-link";

test("an unknown link is not valid; a used, expired or replaced link says what happened and what to do", () => {
  expect(linkProblem(404, "not_found").title).toBe("This link isn't valid");
  expect(linkProblem(410, "link_used").title).toBe("This link has already been used");
  expect(linkProblem(410, "link_expired").body).toContain("ask your agent");
  expect(linkProblem(410, "link_superseded").title).toBe("This agreement has been replaced");
  expect(linkProblem(410, "offer_expired").title).toBe("This offer has expired");
  expect(linkProblem(410, "offer_closed").title).toBe("This offer is closed");
  expect(linkProblem(410, "offer_withdrawn").title).toBe("This offer was withdrawn");
  expect(linkProblem(500, "internal").title).toBe("Something went wrong");
});

test("no message names AML, a check or a screening", () => {
  for (const [s, c] of [
    [404, "not_found"],
    [410, "link_used"],
    [410, "link_expired"],
    [410, "link_superseded"],
    [500, "x"],
  ] as const) {
    const p = linkProblem(s, c);
    expect(`${p.title} ${p.body}`).not.toMatch(/aml|launder|sanction|screen|check/i);
  }
  for (const c of ["name_mismatch", "not_your_turn", "consent_required", "invalid_request", "other"])
    expect(signError(c)).not.toMatch(/aml|launder|sanction|screen/i);
});

test("a name that does not match tells the signer to type it as written", () => {
  expect(signError("name_mismatch")).toContain("as it is written");
  expect(signError("not_your_turn")).toContain("earlier");
});

test("portal links (C35, S67): a used documents link, a closed purchase and every upload refusal read in plain words", () => {
  expect(linkProblem(410, "link_used", "portal").title).toBe("You have already sent your documents");
  expect(linkProblem(410, "link_closed").title).toBe("This purchase is closed");
  expect(linkProblem(410, "link_superseded", "portal").body).toContain("newest email");
  for (const c of [
    "kind_not_asked",
    "invalid_file",
    "rate_limited",
    "link_used",
    "link_expired",
    "nothing_uploaded",
    "x",
  ])
    expect(uploadError(c)).not.toMatch(/aml|launder|sanction|screen|risk|flag|code|status \d/i);
  expect(uploadError("invalid_file")).toContain("10 MB");
  expect(uploadError("kind_not_asked")).toContain("asked you for");
  expect(uploadError("nothing_uploaded")).toContain("at least one");
});
