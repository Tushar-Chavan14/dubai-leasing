import { normaliseName } from "../aml/similarity.ts";
import type { Finding } from "./company.ts";
import type { interpretDeed } from "./interpret.ts";

export interface OwnershipInput {
  deed: ReturnType<typeof interpretDeed>;
  /** The unit the deal holds (resale). Null: not checked, which means review. */
  dealUnitNo: string | null;
  sellers: {
    name: string;
    kind: "person" | "company";
    /** For a company seller, the trade name read from its licence; null/undefined if none has been read. */
    licenceName?: string | null | undefined;
  }[];
  /** Some read of the deed or a licence had instruction-like text: never a "matched" (S52 amendment). */
  instructionFound?: boolean;
  /** The C5 listing matching (`matchOwners`, exported by the engine's `listings.ts`): one to one, every owner a seller. */
  matchOwners: (docNames: string[], sellerNames: string[]) => { matched: boolean; reasons: string[] };
}

/**
 * The C5 match of owners on an ownership document to a record's sellers (S14): equal after normalising, one to one, every
 * owner a seller and every seller an owner. A name with no letters never matches. Shared by `recordOwnership` and the
 * C20 ownership check, so there is one place that decides it.
 */
export function matchOwners(
  ownersOnDocument: readonly string[],
  sellerNames: readonly string[],
): { matched: boolean; reasons: string[] } {
  const docNames = ownersOnDocument.map(normaliseName);
  // One-to-one (review #1): each seller is used by at most one name on the document.
  const left = sellerNames.map((n) => normaliseName(n)).filter((n) => n !== "");
  const reasons: string[] = [];
  if (docNames.length !== sellerNames.length)
    reasons.push(`The document names ${docNames.length} owner(s); the record has ${sellerNames.length} seller(s).`);
  ownersOnDocument.forEach((n, i) => {
    const at = docNames[i] === "" ? -1 : left.indexOf(docNames[i]!);
    if (at === -1) reasons.push(`${n} on the document is not a seller on the record.`);
    else left.splice(at, 1);
  });
  return { matched: reasons.length === 0, reasons };
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * What the ownership document must show (S14, S52): owners match the sellers one to one (the C5 function), shares add
 * to exactly 10000 bps, the property number is the deal's, and a company owner is the licence's name. Anything not
 * read or not checkable is `review`, never `matched`.
 */
export function ownershipChecks(i: OwnershipInput): { status: "matched" | "review"; findings: Finding[] } {
  const findings: Finding[] = [];
  const add = (code: string, message: string) => findings.push({ code, message, severity: "review" });
  const d = i.deed;
  if (d.ownersUnread) add("owner_unread", "An owner's name couldn't be read clearly.");
  if (!d.owners.length) add("owners_missing", "No owner could be read from the document.");
  else {
    const m = i.matchOwners(
      d.owners.map((o) => o.name),
      i.sellers.map((s) => s.name),
    );
    if (!m.matched) add("owners_mismatch", m.reasons.join(" "));
  }
  if (d.sharesUnread) add("share_unread", "An owner's share couldn't be read clearly.");
  else if (d.owners.length && d.owners.reduce((n, o) => n + (o.bps ?? 0), 0) !== 10_000)
    add("shares_not_100", "The owners' shares don't add up to exactly 100%.");
  if (!d.propertyNumber) add("property_unread", "The property number couldn't be read clearly.");
  else if (!i.dealUnitNo)
    add("property_not_checked", "The deal holds no unit number to check the property number against.");
  else if (alnum(d.propertyNumber) !== alnum(i.dealUnitNo))
    add("property_mismatch", "The property number isn't the deal's unit.");
  for (const s of i.sellers.filter((x) => x.kind === "company")) {
    if (!d.owners.some((o) => normaliseName(o.name) === normaliseName(s.name))) continue;
    if (!s.licenceName)
      add("licence_not_read", "A company owner's trade licence hasn't been read, so its name isn't checked.");
    else if (normaliseName(s.licenceName) !== normaliseName(s.name))
      add("licence_name_mismatch", "A company owner's name isn't the name on its trade licence.");
  }
  if (i.instructionFound)
    add("instruction_found", "Text on a document reads like an instruction. It was ignored; a person must review it.");
  return { status: findings.length ? "review" : "matched", findings };
}
