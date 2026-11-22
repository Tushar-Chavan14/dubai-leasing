import {
  type OqoodRegisterPayload,
  type OqoodTransferPayload,
  RegistryRejection,
  type RegistryResult,
  RegistryUnavailableError,
  type TrusteeTransferPayload,
} from "@spa/core";
import { z } from "zod";
import type { OqoodAdapter, RegistryCallOptions, TransferAdapter } from "./types.ts";

const Issued = z.object({ status: z.literal("issued"), no: z.string(), issuedOn: z.string() });
const Rejected = z.object({ status: z.literal("rejected"), reasons: z.array(RegistryRejection).min(1) });
const Answer = z.discriminatedUnion("status", [Issued, Rejected]);

/**
 * HTTP client for the simulated Oqood and trustee registry (`modules/spa/apps/oqood-mock`, `REGISTRY_MOCK_URL`). The
 * real registry's adapter will speak the same contract. A network error, a timeout or a 5xx is
 * `RegistryUnavailableError` (nothing was registered, try later); a 422 with reasons is a rejection.
 */
export class HttpOqoodAdapter implements OqoodAdapter, TransferAdapter {
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
      throw new RegistryUnavailableError(
        `The registry could not be reached: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (res.status >= 500) {
      const detail = await res.text().catch(() => "");
      throw new RegistryUnavailableError(`The registry answered ${res.status}: ${detail.slice(0, 200)}`);
    }
    return res;
  }

  private async result(res: Response): Promise<RegistryResult> {
    if (res.status !== 200 && res.status !== 201 && res.status !== 422)
      throw new Error(`unexpected registry answer ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const a = Answer.parse(await res.json());
    return a.status === "issued" ? { ok: true, no: a.no, issuedOn: a.issuedOn } : { ok: false, reasons: a.reasons };
  }

  async register(p: OqoodRegisterPayload, o: RegistryCallOptions): Promise<RegistryResult> {
    return this.result(await this.call("POST", "/api/v1/oqood/register", { requestId: o.requestId, payload: p }));
  }
  async transfer(p: OqoodTransferPayload, o: RegistryCallOptions): Promise<RegistryResult> {
    return this.result(await this.call("POST", "/api/v1/oqood/transfer", { requestId: o.requestId, payload: p }));
  }
  async book(p: TrusteeTransferPayload, o: RegistryCallOptions): Promise<RegistryResult> {
    return this.result(await this.call("POST", "/api/v1/trustee/transfers", { requestId: o.requestId, payload: p }));
  }
  async status(no: string): Promise<{ state: "registered" | "unknown" }> {
    const res = await this.call("GET", `/api/v1/oqood/${encodeURIComponent(no)}`);
    if (res.status === 404) return { state: "unknown" };
    z.object({ state: z.literal("registered") }).parse(await res.json());
    return { state: "registered" };
  }
  async certificate(no: string): Promise<Uint8Array> {
    const res = await this.call("GET", `/api/v1/oqood/${encodeURIComponent(no)}/certificate.pdf`);
    if (!res.ok) throw new Error(`certificate not available (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("the certificate is not a PDF");
    return bytes;
  }
}
