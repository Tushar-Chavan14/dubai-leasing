import type { EjariPayload, EjariRejection } from "@leasing/core";

/**
 * Ejari adapter (architecture §9). `mock` talks to the simulated Ejari service (labelled
 * simulated everywhere); `dld` follows the same contract once DLD access exists.
 */
export type EjariContractPayload = EjariPayload;
export type { EjariRejection };

export type EjariResult = { ok: true; ejariNo: string; issuedOn: string } | { ok: false; reasons: EjariRejection[] };

export interface EjariAdapter {
  /** `requestId` makes a retry safe: the same id returns the first answer, never a second registration. */
  register(c: EjariContractPayload, opts: { requestId: string }): Promise<EjariResult>;
  renew(ejariNo: string, c: EjariContractPayload, opts: { requestId: string }): Promise<EjariResult>;
  cancel(ejariNo: string, reason: string): Promise<{ ok: boolean }>;
  status(ejariNo: string): Promise<{ state: "active" | "cancelled" | "unknown" }>;
  /** The registration certificate as PDF. */
  certificate(ejariNo: string): Promise<Uint8Array>;
}

/** The registry could not be reached or failed (network, 5xx, maintenance): retry later. Not a rejection. */
export class EjariUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EjariUnavailableError";
  }
}
