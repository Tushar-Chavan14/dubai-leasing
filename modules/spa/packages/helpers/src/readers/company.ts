import { addDays, type CalendarDate } from "@platform/kernel/dates";
import { normaliseName } from "../aml/similarity.ts";
import type { interpretAuthority, interpretLicence, interpretMoa } from "./interpret.ts";

export interface Finding {
  code: string;
  message: string;
  /** `review` sends the check to a sales manager; `info` is shown only. */
  severity: "review" | "info";
}

export interface CompanyCheckInput {
  today: CalendarDate;
  /** The licence must be valid at least this many days from today (assumption: confirm with legal, S52). */
  minLicenceDays: number;
  targetTransferOn: string | null;
  /** The rulebook's `beneficialOwnerBps`. */
  ownerThresholdBps: number;
  /** The company's name on the deal. */
  partyName: string;
  licence: ReturnType<typeof interpretLicence> | null;
  moa: ReturnType<typeof interpretMoa> | null;
  authorities: ReturnType<typeof interpretAuthority>[];
  /** Who the records say signs for the company, and under which kind of authority. */
  signatories: { name: string; authority: "poa" | "board_resolution" }[];
  instructionFound: boolean;
}

export interface CompanyCheckResult {
  status: "passed" | "review";
  findings: Finding[];
  signerOk: boolean;
  licenceExpiresOn: string | null;
  /** Shareholders at or above the threshold, as read. */
  owners: { name: string; bps: number; corporate: boolean }[];
  /** Person owners to record as beneficial owners: only on clear readings that add to at most 100%. */
  ownersToAdd: { name: string; bps: number }[];
  /** Ownership layers code could not resolve; the AML rule counts them (S50). */
  layers: number;
}

const same = (a: string, b: string) => normaliseName(a) !== "" && normaliseName(a) === normaliseName(b);

/**
 * The code checks of a company (S14, S52): the licence is valid and long enough, a named signer holds a power over
 * property, and which shareholders hold at least the threshold. The model read the text; every verdict is here. It
 * never concludes "no other owners" by default: a missing page, an unread percentage, a corporate shareholder or
 * shares that don't add to 100% each give `review` and count an ownership layer.
 */
export function companyChecks(i: CompanyCheckInput): CompanyCheckResult {
  const findings: Finding[] = [];
  const add = (code: string, message: string, severity: "review" | "info" = "review") =>
    findings.push({ code, message, severity });

  // Licence
  const lic = i.licence;
  let licenceExpiresOn: string | null = null;
  if (!lic) add("licence_missing", "No trade licence has been read.");
  else if (lic.unreadable.length)
    add("licence_unread", `The licence couldn't be read clearly: ${lic.unreadable.join(", ")}.`);
  else {
    licenceExpiresOn = lic.expiresOn;
    if (lic.expiresOn! < i.today) add("licence_expired", "The trade licence has expired.");
    else if (
      lic.expiresOn! < addDays(i.today, i.minLicenceDays) ||
      (i.targetTransferOn !== null && lic.expiresOn! < i.targetTransferOn)
    )
      add("licence_too_short", "The trade licence doesn't stay valid long enough for this deal.");
    if (lic.tradeName && !same(lic.tradeName, i.partyName))
      add("licence_name_mismatch", "The name on the licence isn't the company's name on the deal.");
  }

  // Signer
  let signerOk = false;
  if (!i.signatories.length) add("no_signatory", "No signatory is recorded for this company.");
  if (!i.authorities.length) add("authority_missing", "No power of attorney or board resolution has been read.");
  for (const a of i.authorities) {
    if (!a.signerName) {
      add("signer_unread", "The signer's name couldn't be read from the authority document.");
      continue;
    }
    const recorded = i.signatories.find((s) => same(s.name, a.signerName!) && s.authority === a.kind);
    if (!recorded && i.signatories.length) {
      add(
        "signer_mismatch",
        "The person named in the authority document isn't a recorded signatory under that authority.",
      );
      continue;
    }
    if (!a.coversProperty) {
      add(
        "power_not_property",
        "The authority document doesn't list a power over the sale, purchase or transfer of property.",
      );
      continue;
    }
    if (a.validUntilUnread) {
      add("authority_unread", "The end date of the authority couldn't be read.");
      continue;
    }
    if (a.validUntil && a.validUntil < i.today) {
      add("authority_expired", "The authority document has expired.");
      continue;
    }
    if (recorded) signerOk = true;
  }

  // Owners
  const moa = i.moa;
  let layers = 0;
  let owners: CompanyCheckResult["owners"] = [];
  let ownersToAdd: CompanyCheckResult["ownersToAdd"] = [];
  if (!moa) {
    add("moa_missing", "No memorandum of association has been read, so the owners are unknown.");
    layers++;
  } else {
    const pageProblem = moa.pages !== "complete";
    if (pageProblem) {
      add("page_missing", "A page of the memorandum may be missing, or its page numbers couldn't be read.");
      layers++;
    }
    if (moa.percentUnread) {
      add("percent_unread", "A shareholder's percentage couldn't be read clearly.");
      layers++;
    }
    const corporate = moa.shareholders.filter((s) => s.corporate);
    if (corporate.length) {
      add("corporate_shareholder", "A shareholder is a company: the real owners behind it are not known.");
      layers += corporate.length;
    }
    const total = moa.shareholders.reduce((n, s) => n + (s.bps ?? 0), 0);
    if (total > 10_000) add("shares_over_100", "The shareholders' percentages add up to more than 100%.");
    else if (!moa.percentUnread && total < 10_000 && moa.shareholders.length)
      add("shares_under_100", "The shareholders' percentages add up to less than 100%: an owner may be missing.");
    if (!moa.shareholders.length && !moa.percentUnread)
      add("no_shareholders", "No shareholder could be read from the memorandum.");
    if (moa.companyName && !same(moa.companyName, i.partyName))
      add("moa_name_mismatch", "The company name in the memorandum isn't the company's name on the deal.");
    owners = moa.shareholders
      .filter((s): s is typeof s & { bps: number } => s.bps !== null && s.bps >= i.ownerThresholdBps)
      .map((s) => ({ name: s.name, bps: s.bps, corporate: s.corporate }));
    // Owners are added only when every percentage was read clearly, no page is missing and the total is at most 100%.
    if (!pageProblem && !moa.percentUnread && total <= 10_000)
      ownersToAdd = owners.filter((o) => !o.corporate).map((o) => ({ name: o.name, bps: o.bps }));
  }
  if (i.instructionFound)
    add(
      "instruction_found",
      "Text on a document reads like an instruction. It was ignored; a person must review the company.",
      "review",
    );
  return {
    status: findings.some((f) => f.severity === "review") ? "review" : "passed",
    findings,
    signerOk,
    licenceExpiresOn,
    owners,
    ownersToAdd,
    layers,
  };
}
