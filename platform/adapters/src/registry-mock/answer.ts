/** What a submission is answered with: issued (201) or rejected (422). An outage is no answer at all (null). */
export interface RegistryAnswer {
  http: 201 | 422;
  body: unknown;
}

export const UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Try again later.";

/**
 * True when this request should be answered "temporarily unavailable" (503), to show retries in demos. `random` is
 * injectable so tests are exact; the failure rate is 0..1.
 */
export function maybeUnavailable(o: {
  failureRate?: number | undefined;
  random?: (() => number) | undefined;
}): boolean {
  return (o.random ?? Math.random)() < (o.failureRate ?? 0);
}

/**
 * A repeated request id gets the first answer back: `lookup` finds the stored submission, `toAnswer` turns it into
 * the answer it got. Null means a new request. A retry therefore never registers twice.
 */
export async function replayByRequestId<Row>(
  lookup: () => Promise<Row | undefined | null>,
  toAnswer: (row: Row) => RegistryAnswer,
): Promise<RegistryAnswer | null> {
  const row = await lookup();
  return row ? toAnswer(row) : null;
}

/** A schema error (anything with an `issues` list, as Zod throws) is a 400 with the messages. */
const issuesOf = (e: unknown): string[] | null => {
  const issues = (e as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? issues.map((i) => String((i as { message?: unknown }).message)) : null;
};

/** A submission's answer as HTTP: 201 issued, 422 rejected, 503 unavailable (null answer), 400 invalid. */
export async function replyWithAnswer(
  c: { json: (b: unknown, s: 201 | 400 | 422 | 503) => Response },
  run: () => Promise<RegistryAnswer | null>,
): Promise<Response> {
  try {
    const a = await run();
    if (!a) return c.json({ error: UNAVAILABLE_MESSAGE }, 503);
    return c.json(a.body, a.http);
  } catch (e) {
    const issues = issuesOf(e);
    if (issues) return c.json({ error: "invalid request", issues }, 400);
    throw e;
  }
}
