import type { EjariAdapter, EjariContractPayload, EjariResult } from "./types.ts";

/**
 * Test double: answers each registration from a script (or issues one by default) and records
 * the calls. A repeated request id gets the first answer again, like the real service.
 */
export class FakeEjari implements EjariAdapter {
  calls: { payload: EjariContractPayload; requestId: string }[] = [];
  private answers = new Map<string, EjariResult>();
  private n = 0;
  constructor(
    private readonly script: (p: EjariContractPayload, call: number) => EjariResult | Error = (_p, call) => ({
      ok: true,
      ejariNo: `SIM-TEST-${String(call).padStart(7, "0")}`,
      issuedOn: "2026-01-01",
    }),
  ) {}
  async register(payload: EjariContractPayload, opts: { requestId: string }): Promise<EjariResult> {
    this.calls.push({ payload, requestId: opts.requestId });
    const seen = this.answers.get(opts.requestId);
    if (seen) return seen;
    const r = this.script(payload, ++this.n);
    if (r instanceof Error) throw r;
    this.answers.set(opts.requestId, r);
    return r;
  }
  renew(_no: string, payload: EjariContractPayload, opts: { requestId: string }): Promise<EjariResult> {
    return this.register(payload, opts);
  }
  async cancel(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
  async status(): Promise<{ state: "active" | "cancelled" | "unknown" }> {
    return { state: "active" };
  }
  async certificate(ejariNo: string): Promise<Uint8Array> {
    return new TextEncoder().encode(`%PDF-1.4\n% simulated certificate ${ejariNo}\n%%EOF\n`);
  }
}
