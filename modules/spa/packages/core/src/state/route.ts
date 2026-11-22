import type { DealEvent, DealFacts, DealMachineEvent } from "./deal.ts";

/** Maps a public deal event to the machine event for this deal's type and flags (S35). */
export function routeDealEvent(
  event: DealEvent,
  f: Pick<DealFacts, "type" | "sellerMortgage" | "buyerMortgage" | "planTakenOver">,
): DealMachineEvent {
  switch (event) {
    case "ALL_SIGNED":
      return f.type === "primary_offplan" ? "ALL_SIGNED_PRIMARY" : "ALL_SIGNED_RESALE";
    case "NOC_OK":
      return f.sellerMortgage || f.buyerMortgage ? "NOC_OK_FINANCE" : "NOC_OK_SETTLEMENT";
    case "TRANSFERRED":
      return f.type === "resale_offplan" && f.planTakenOver ? "TRANSFERRED_PLAN" : "TRANSFERRED_COMPLETE";
    default:
      return event;
  }
}
