import type { SpaRole } from "@spa/core/roles";

const DEAL = /^\/(?:deals\/|work\?.*\bdeal)/;

/** The ready-made questions in the empty agent panel: text only, at most four. A chip sends its text as typed. */
export function startersFor(role: SpaRole, path: string): string[] {
  const compliance = role === "compliance_officer" || role === "mlro";
  const base = path.split("?")[0] ?? "";
  let list: string[];
  if (DEAL.test(path)) list = ["What is this deal waiting for?", "Draft a summary of this deal"];
  else if (base.startsWith("/listings")) list = ["Which listings are published?"];
  else if (base.startsWith("/settings")) list = ["Which templates are waiting for approval?"];
  else
    list = [
      "What is waiting for me?",
      "Which deals are in party check?",
      "Which units are available?",
      "What can you help me with?",
    ];
  if (compliance) list = ["Which cases are open?", ...list];
  return list.slice(0, 4);
}
