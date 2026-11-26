import { Fact } from "@platform/ui/record";
import { Pill } from "@platform/ui/pill";
import type { PartyView } from "../lib/contracts";
import { shareLabel } from "../lib/format";

const KYC: Record<string, { tone: "accent" | "warning" | "danger" | "neutral"; text: string }> = {
  passed: { tone: "accent", text: "Passed" },
  review: { tone: "warning", text: "Review open" },
  blocked: { tone: "danger", text: "Blocked" },
  needs_human: { tone: "warning", text: "Needs a person" },
};

/**
 * One party (design §4.3 item 3): role, share, the identity check result and, for sales roles, only whether a
 * compliance review is open. The name comes masked from the engine; no ID, passport or phone number is shown.
 */
export function PartyCard({ party }: { party: PartyView }) {
  const kyc = party.kyc
    ? (KYC[party.kyc.status] ?? { tone: "neutral" as const, text: "Checked" })
    : { tone: "neutral" as const, text: "Not started" };
  const share = shareLabel(party.shareBps);
  return (
    <li className="m-0 grid gap-2 rounded-xl border border-line bg-page p-3.5">
      <div className="min-w-0">
        <b className="block font-semibold [overflow-wrap:anywhere]">{party.name}</b>
        <span className="block text-[12.5px] text-muted">
          {party.role === "buyer" ? "Buyer" : "Seller"}
          {party.order > 1 ? ` ${party.order}` : ""} · {party.kind === "company" ? "Company" : "Person"}
          {share ? ` · ${share}` : ""}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-2">
        <Fact label="Identity check">
          <Pill tone={kyc.tone}>{kyc.text}</Pill>
        </Fact>
        <Fact label={party.compliance.label}>
          <Pill tone={party.compliance.status === "open" ? "warning" : "neutral"}>
            {party.compliance.status === "open" ? "Review open" : "None"}
          </Pill>
        </Fact>
      </dl>
    </li>
  );
}
