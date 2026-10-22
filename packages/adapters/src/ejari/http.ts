import { EjariRejection } from "@leasing/core";
import { z } from "zod";
import { type EjariAdapter, type EjariContractPayload, type EjariResult, EjariUnavailableError } from "./types.ts";

const Issued = z.object({ status: z.literal("issued"), ejariNo: z.string(), issuedOn: z.string() });
const Rejected = z.object({ status: z.literal("rejected"), reasons: z.array(EjariRejection).min(1) });
const Answer = z.discriminatedUnion("status", [Issued, Rejected]);

/**
 * HTTP client for the simulated Ejari service (`apps/ejari-mock`). The DLD adapter will speak
 * the same contract. Network errors, timeouts and 5xx answers are `EjariUnavailableError`
 * (retry later); a 422 with reasons is a rejection.
 */
export class HttpEjariClient implements EjariAdapter {
  private readonly base: string;
  private readonly fetch: (req: Request) => Promise<Response>;
  constructor(opts: { baseUrl: string; fetch?: (req: Request) => Promise<Response>; timeoutMs?: number }) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    const timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetch = opts.fetch ?? ((req) => fetch(req, { signal: AbortSignal.timeout(timeoutMs) }));
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetch(
        new Request(`${this.base}${path}`, {
          method,
          ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
        }),
      );
    } catch (e) {
      throw new EjariUnavailableError(`Ejari could not be reached: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status >= 500) {
      const detail = await res.text().catch(() => "");
      throw new EjariUnavailableError(`Ejari answered ${res.status}: ${detail.slice(0, 200)}`);
    }
    return res;
  }

  private async result(res: Response): Promise<EjariResult> {
    if (res.status !== 200 && res.status !== 201 && res.status !== 422) {
      throw new Error(`unexpected Ejari answer ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const a = Answer.parse(await res.json());
    return a.status === "issued"
      ? { ok: true, ejariNo: a.ejariNo, issuedOn: a.issuedOn }
      : { ok: false, reasons: a.reasons };
  }

  async register(c: EjariContractPayload, opts: { requestId: string }): Promise<EjariResult> {
    return this.result(await this.call("POST", "/api/v1/registrations", { requestId: opts.requestId, contract: c }));
  }

  async renew(ejariNo: string, c: EjariContractPayload, opts: { requestId: string }): Promise<EjariResult> {
    return this.result(
      await this.call("POST", `/api/v1/registrations/${encodeURIComponent(ejariNo)}/renew`, {
        requestId: opts.requestId,
        contract: c,
      }),
    );
  }

  async cancel(ejariNo: string, reason: string): Promise<{ ok: boolean }> {
    const res = await this.call("POST", `/api/v1/registrations/${encodeURIComponent(ejariNo)}/cancel`, { reason });
    return { ok: res.ok };
  }

  async status(ejariNo: string): Promise<{ state: "active" | "cancelled" | "unknown" }> {
    const res = await this.call("GET", `/api/v1/registrations/${encodeURIComponent(ejariNo)}`);
    if (res.status === 404) return { state: "unknown" };
    const s = z.object({ state: z.enum(["active", "cancelled"]) }).parse(await res.json());
    return { state: s.state };
  }

  async certificate(ejariNo: string): Promise<Uint8Array> {
    const res = await this.call("GET", `/api/v1/registrations/${encodeURIComponent(ejariNo)}/certificate.pdf`);
    if (!res.ok) throw new Error(`certificate not available (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("the certificate is not a PDF");
    return bytes;
  }
}
