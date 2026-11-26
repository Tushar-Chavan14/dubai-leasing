export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    readonly code: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(`${what} not found`, 404, "not_found");
export const unauthorised = (why = "unauthorised") => new DomainError(why, 401, "unauthorised");
export const forbidden = (why: string) => new DomainError(why, 403, "forbidden");
export const conflict = (why: string, code = "conflict") => new DomainError(why, 409, code);
export const unprocessable = (why: string, reasons: string[] = [], code = "unprocessable") =>
  new DomainError(why, 422, code, reasons);
