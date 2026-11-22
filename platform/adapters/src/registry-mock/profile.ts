/**
 * The wording of one simulated registry (AGENTS rule 9): every certificate, page and PDF says "simulated" and says
 * what the demo service is not connected to. A module supplies its own profile; the shell has no domain wording.
 */
export interface RegistryMockProfile {
  /** The registry's name in the console, e.g. "Ejari (simulated)". */
  systemLabel: string;
  wording: {
    /** The certificate's visible title. */
    title: string;
    /** The line under the title: says it is a demo and what it is not connected to. */
    subline: string;
    /** Drawn across the certificate page. */
    watermark: string;
    /** The PDF's producer field. */
    producer: string;
  };
}
