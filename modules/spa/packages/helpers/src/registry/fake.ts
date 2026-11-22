import type {
  OqoodRegisterPayload,
  OqoodTransferPayload,
  RegistryRejection,
  RegistryResult,
  TrusteeTransferPayload,
} from "@spa/core";
import { RegistryUnavailableError } from "@spa/core";
import type { OqoodAdapter, RegistryCallOptions, TransferAdapter } from "./types.ts";

/** `lost`: the registry registers the request but its answer never arrives (the caller sees an outage). */
type Script = "issue" | "unavailable" | "lost" | { reject: RegistryRejection[] };

/**
 * An adapter for tests: no network. It records every call (payload and request id), answers as scripted and, like the
 * registry, gives a repeated request id its first answer. The issue date is fixed by the test.
 */
export class FakeOqood implements OqoodAdapter, TransferAdapter {
  readonly calls: { kind: "register" | "transfer" | "book"; payload: unknown; requestId: string }[] = [];
  private next: Script[] = [];
  private seq = 0;
  /** How many registry numbers this fake has issued (a replay issues none). */
  get numbersIssued(): number {
    return this.seq;
  }
  private readonly answers = new Map<string, RegistryResult>();
  constructor(private readonly opts: { issuedOn?: string } = {}) {}

  /** The next calls (in order) answer these; with none left, a call issues a number. */
  script(...s: Script[]): this {
    this.next.push(...s);
    return this;
  }

  private answer(kind: "register" | "transfer" | "book", payload: unknown, o: RegistryCallOptions): RegistryResult {
    this.calls.push({ kind, payload, requestId: o.requestId });
    const key = `${kind}:${o.requestId}`;
    const replay = this.answers.get(key);
    if (replay) return replay;
    const s = this.next.shift() ?? "issue";
    if (s === "unavailable") throw new RegistryUnavailableError("The registry answered 503: simulated outage");
    const lost = s === "lost";
    const prefix = kind === "register" ? "OQD" : "TRF";
    const r: RegistryResult =
      s === "issue" || lost
        ? {
            ok: true,
            no: `SIM-${prefix}-2026-${String(++this.seq).padStart(7, "0")}`,
            issuedOn: this.opts.issuedOn ?? "2026-11-19",
          }
        : { ok: false, reasons: s.reject };
    this.answers.set(key, r);
    if (lost) throw new RegistryUnavailableError("The registry did not answer in time: simulated lost reply");
    return r;
  }

  async register(p: OqoodRegisterPayload, o: RegistryCallOptions) {
    return this.answer("register", p, o);
  }
  async transfer(p: OqoodTransferPayload, o: RegistryCallOptions) {
    return this.answer("transfer", p, o);
  }
  async book(p: TrusteeTransferPayload, o: RegistryCallOptions) {
    return this.answer("book", p, o);
  }
  async status(): Promise<{ state: "registered" | "unknown" }> {
    return { state: "registered" };
  }
  async certificate(): Promise<Uint8Array> {
    return new TextEncoder().encode("%PDF-1.4 fictional");
  }
}
