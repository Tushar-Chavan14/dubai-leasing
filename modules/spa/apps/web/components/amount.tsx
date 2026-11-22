import { Pill } from "@platform/ui/pill";
import { formatMoneyFils } from "../lib/format";

/** Money from integer fils, tabular digits. An amount a document gave that no person confirmed is flagged (design §6.1). */
export function Amount({ fils, confirmed = true }: { fils: number; confirmed?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{formatMoneyFils(fils)}</span>
      {!confirmed && <Pill tone="warning">Read, not confirmed</Pill>}
    </span>
  );
}
