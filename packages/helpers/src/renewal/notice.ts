import { formatAed } from "@leasing/core";

/**
 * Renewal notice content (English). Structured blocks so the same content renders to PDF and
 * email. WORDING TO BE REVIEWED BY A DUBAI PROPERTY LAWYER before real use (README).
 */
export type NoticeBlock =
  | { kind: "title"; text: string }
  | { kind: "meta"; rows: [string, string][] }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "facts"; rows: [string, string][] }
  | { kind: "list"; items: string[] }
  | { kind: "small"; text: string };

export interface NoticeDocument {
  title: string;
  blocks: NoticeBlock[];
}

export interface RenewalNoticeInput {
  reference: string;
  issuedOn: string;
  tenantName: string;
  landlordName: string;
  unit: {
    code: string;
    building: string;
    community: string;
    unitNo: string | null;
    dldPropertyNo: string | null;
    makaniNo: string | null;
  };
  leaseRef: string;
  ejariNo: string | null;
  leaseEndOn: string;
  currentRentFils: number;
  proposedRentFils: number;
  newTermStartOn: string;
  newTermEndOn: string;
  rulesVersion: string;
  /** Legal notice period from the rulebook for `rulesVersion` (never written into the text). */
  renewalNoticeDays: number;
  maxIncreasePercent: number;
  sriAverageFils: number | null;
  /** True when sent as the same-rent fallback after the 90-day deadline. */
  sameRentFallback: boolean;
  /** Demo builds say so on the notice (simulated Ejari, wording not yet reviewed). */
  demo: boolean;
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${d}T08:00:00Z`),
  );

export function renewalNotice(n: RenewalNoticeInput): NoticeDocument {
  const increase = n.proposedRentFils > n.currentRentFils;
  const title = increase ? "Notice of tenancy renewal and rent change" : "Notice of tenancy renewal";
  // Display only: integer basis points, rounded down, so the stated change never overstates it.
  const bp = increase ? Math.floor(((n.proposedRentFils - n.currentRentFils) * 10_000) / n.currentRentFils) : 0;
  const pct = `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;
  return {
    title,
    blocks: [
      { kind: "title", text: title },
      {
        kind: "meta",
        rows: [
          ["Reference", n.reference],
          ["Date", fmtDate(n.issuedOn)],
          ["To (tenant)", n.tenantName],
          ["From (landlord)", n.landlordName],
        ],
      },
      { kind: "heading", text: "The property" },
      {
        kind: "facts",
        rows: [
          ["Unit", `${n.unit.unitNo ?? n.unit.code}, ${n.unit.building}, ${n.unit.community}, Dubai`],
          ["DLD property number", n.unit.dldPropertyNo ?? "—"],
          ["Makani number", n.unit.makaniNo ?? "—"],
          ["Lease reference", n.leaseRef],
          ["Ejari number", n.ejariNo ?? "—"],
        ],
      },
      { kind: "heading", text: "What we are offering" },
      {
        kind: "para",
        text: `Your tenancy ends on ${fmtDate(n.leaseEndOn)}. We are offering to renew it for a new term from ${fmtDate(n.newTermStartOn)} to ${fmtDate(n.newTermEndOn)}, on the same terms except as set out below.`,
      },
      {
        kind: "facts",
        rows: [
          ["Current annual rent", formatAed(n.currentRentFils)],
          ["Annual rent for the new term", formatAed(n.proposedRentFils)],
          ["Change", increase ? `+${pct}%` : "No change"],
        ],
      },
      ...(increase
        ? ([
            {
              kind: "para",
              text: `The increase is within the maximum allowed for this renewal (${n.maxIncreasePercent}%), based on the Smart Rental Index average for similar homes${n.sriAverageFils ? ` of ${formatAed(n.sriAverageFils)} a year` : ""}. This notice is given at least ${n.renewalNoticeDays} days before the end of the tenancy.`,
            },
          ] satisfies NoticeBlock[])
        : n.sameRentFallback
          ? ([
              {
                kind: "para",
                text: `Because the ${n.renewalNoticeDays}-day notice period for a rent change has passed, the rent for the new term stays the same.`,
              },
            ] satisfies NoticeBlock[])
          : []),
      { kind: "heading", text: "Please reply" },
      {
        kind: "list",
        items: [
          "Confirm you have received this notice using the link in the email.",
          "Then tell us whether you want to renew, plan to move out, or would like to discuss the terms.",
          "If you plan to move out, please tell us as early as possible.",
        ],
      },
      {
        kind: "small",
        text: n.demo
          ? `Prepared under rules version ${n.rulesVersion}. Demo build: wording to be reviewed by a Dubai property lawyer before real use. Ejari in this build is simulated.`
          : `Prepared under rules version ${n.rulesVersion}.`,
      },
    ],
  };
}

/** Plain-text rendering (email body and the hash of what was sent). */
export function noticeToText(doc: NoticeDocument): string {
  return doc.blocks
    .map((b) => {
      switch (b.kind) {
        case "title":
          return b.text.toUpperCase();
        case "heading":
          return `\n${b.text}`;
        case "para":
        case "small":
          return b.text;
        case "meta":
        case "facts":
          return b.rows.map(([k, v]) => `${k}: ${v}`).join("\n");
        case "list":
          return b.items.map((i) => `- ${i}`).join("\n");
      }
    })
    .join("\n");
}
