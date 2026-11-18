/** Waiting vs running, and whether the company template is already ready, so they don't look like one stuck process. */
export function readingLabel(sample: {
  phase?: "waiting" | "running" | null;
  minutes?: number | null;
  templateReady?: boolean;
}): string {
  const n = sample.minutes ?? 0;
  const detail =
    sample.phase === "waiting"
      ? `Waiting for the model (queued ${n} min)`
      : sample.phase === "running"
        ? `Reading clauses (started ${n} min ago)`
        : "Reading the contract";
  return sample.templateReady ? `Template ready \u2014 clause reading still running. ${detail}.` : `${detail}\u2026`;
}

/** Applied / Held as before; a document check still open reads "Checking", or "Didn't finish" when stuck or failed. */
export function inboundLabel(status: string, check?: "none" | "running" | "stuck" | "failed"): string {
  if (status === "applied") return "Applied";
  if (check === "failed" || check === "stuck") return "Didn\u2019t finish";
  if (status === "stored_only") return "Held";
  return check === "running" ? "Checking" : "Processing";
}
