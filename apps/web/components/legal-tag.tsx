export { needsLegalCheck } from "../lib/clause-legal";

export function LegalTag() {
  return (
    <span className="status" data-tone="warn" style={{ marginLeft: 6 }}>
      Confirm with legal
    </span>
  );
}
