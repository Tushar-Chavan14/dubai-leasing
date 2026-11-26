export { needsLegalCheck } from "../lib/clause-legal";

export function LegalTag() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full border border-warning px-2 py-0.5 font-sans text-xs font-semibold text-warning">
      Confirm with legal
    </span>
  );
}
