/** Status of the automatic contract preparation job, as the engine reports it on the lease contract view. */
export interface PreparingStatus {
  state: "queued" | "running" | "retrying" | "failed";
  since: string;
  attempt: number;
  reason?: string;
  /** What a running preparation is doing (engine text). */
  step?: string;
}

export const PREPARING_HINT = "usually 2–6 minutes";

/** "2m 14s", "59s", "1h 5m". */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function preparingStatusLine(p: PreparingStatus): string {
  switch (p.state) {
    case "queued":
      return "Queued";
    case "running":
      return p.step ?? "Reading records and the template";
    case "retrying":
      return `Retrying (attempt ${p.attempt})`;
    case "failed":
      return p.reason ? `Couldn't prepare: ${p.reason}` : "Couldn't prepare";
  }
}

/** The page refreshes itself only while the job can still finish. */
export const isPreparingLive = (state: PreparingStatus["state"]): boolean => state !== "failed";
