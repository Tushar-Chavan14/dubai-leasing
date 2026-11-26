import type { OqoodRegisterPayload, OqoodTransferPayload, RegistryResult, TrusteeTransferPayload } from "@spa/core";

/** Every call carries a request id: the same id gets the first answer back, so a retry never registers twice. */
export interface RegistryCallOptions {
  requestId: string;
}

/** Oqood: register a primary unit, transfer an off-plan resale, read a record and its certificate. */
export interface OqoodAdapter {
  register(payload: OqoodRegisterPayload, opts: RegistryCallOptions): Promise<RegistryResult>;
  transfer(payload: OqoodTransferPayload, opts: RegistryCallOptions): Promise<RegistryResult>;
  status(no: string): Promise<{ state: "registered" | "unknown" }>;
  certificate(no: string): Promise<Uint8Array>;
}

/** The trustee office: books the title-deed transfer of a ready resale. */
export interface TransferAdapter {
  book(payload: TrusteeTransferPayload, opts: RegistryCallOptions): Promise<RegistryResult>;
}
