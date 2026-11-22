/** Every name on these lists is invented. They stand in for real sanctions and PEP data until C27 wraps a real feed. */
export const AML_LIST_LABEL = "FICTIONAL, SIMULATED";
export const FAKE_LIST_VERSION = "fake-2026-11";

export interface ListEntry {
  id: string;
  name: string;
}
export const FAKE_SANCTIONS: readonly ListEntry[] = Object.freeze([
  { id: "fs-001", name: "Zorvan Ketterly" },
  { id: "fs-002", name: "Mirela Quandt-Vash" },
  { id: "fs-003", name: "Tavish Orlenko-Bray" },
  { id: "fs-004", name: "Bashir Qalmoor Dreyne" },
  { id: "fs-005", name: "Ilyana Drovesk" },
  { id: "fs-006", name: "Okonwe Parrish-Lund" },
]);
export const FAKE_PEPS: readonly ListEntry[] = Object.freeze([
  { id: "fp-001", name: "Halvard Menteth" },
  { id: "fp-002", name: "Sabine Orrelo" },
  { id: "fp-003", name: "Emeric Tolland-Rue" },
  { id: "fp-004", name: "Nuria Vessent Alcorn" },
  { id: "fp-005", name: "Dorian Yelvington" },
]);
