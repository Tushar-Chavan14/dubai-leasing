import type { ChannelSender, EjariAdapter, LocalDiskStore, Mailer } from "@leasing/adapters";
import type { Clock } from "@leasing/core";
import type { Database, Tx } from "@leasing/db";
import type { CopilotModel } from "@leasing/copilot";
import type { Llm } from "@leasing/llm";

export interface JobRequest {
  name: string;
  data: Record<string, unknown>;
  /** "<entityId>:<milestone>" — at most one queued/active job per key (AGENTS.md rule 7). */
  singletonKey: string;
  startAfter?: Date;
}

/** Enqueues jobs in the caller's transaction. pg-boss in the engine, an in-memory fake in tests. */
export interface Scheduler {
  send(tx: Tx, job: JobRequest): Promise<string | null>;
}

export interface EngineContext {
  database: Database;
  clock: Clock;
  scheduler: Scheduler;
  /** Rules version for new leases. Existing leases always use their own `rulesVersion`. */
  rulesVersion: string;
  /** In demo mode deadlines are fired by the sweep (so fast-forward works), not by `startAfter` jobs. */
  demoMode: boolean;
  /** Outbound email (Nodemailer; a fake in tests). */
  mailer: Mailer;
  /** Generated documents (notice PDFs) under DOCUMENTS_DIR. */
  documents: LocalDiskStore;
  /** Tenant uploads (ID documents) under UPLOADS_DIR. Read only by the KYC helper and staff document views. */
  uploads: LocalDiskStore;
  /** Ejari registry: the simulated service in demos (EJARI_MODE=mock), a fake in tests. */
  ejari: EjariAdapter;
  /** Local models (decision model for tenant comments). */
  llm: Llm;
  /** Public base URL of the web app, for links in emails. */
  webUrl: string;
  /** Staff copilot chat model (tool calling). Absent: the chat endpoint answers 503. */
  copilot?: CopilotModel;
  /** Sends an officer's reply into a Telegram enquiry chat. Absent: staff replies answer 503. */
  channel?: ChannelSender;
}
