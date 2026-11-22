/** A refused domain action, with the HTTP status a route will answer with (P8) and a stable code. */
export class SpaDomainError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 410 | 422 | 429 | 503,
    readonly code: string,
    message: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = "SpaDomainError";
  }
}
export const notFound = (what: string) => new SpaDomainError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message: string, reasons: string[] = []) =>
  new SpaDomainError(409, code, message, reasons);
export const unprocessable = (code: string, message: string, reasons: string[] = []) =>
  new SpaDomainError(422, code, message, reasons);
export const forbidden = (message: string) => new SpaDomainError(403, "forbidden", message);
export const gone = (code: string, message: string) => new SpaDomainError(410, code, message);
export const unavailable = (code: string, message: string) => new SpaDomainError(503, code, message);
export const tooMany = (message: string) => new SpaDomainError(429, "rate_limited", message);

const codeOf = (x: unknown) => (x && typeof x === "object" ? (x as { code?: unknown }).code : undefined);
/** A Postgres unique or primary-key clash, whether the driver or drizzle's wrapper carries the code. */
export const isUniqueClash = (e: unknown): boolean =>
  codeOf(e) === "23505" || codeOf((e as { cause?: unknown } | null)?.cause) === "23505";

/**
 * Runs a publish that takes the next version number. Two first publishes both read "no version yet", and the primary key
 * lets one in: the other is a 409 the person can retry, never a 500 (C34, S66).
 */
export async function takingVersion<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isUniqueClash(e))
      throw conflict("version_taken", "someone published at the same moment; look again and try once more");
    throw e;
  }
}
