import type { ChannelSender, LocalDiskStore, Mailer, RegistrationAdapter } from "@leasing/adapters";
import type { Clock, Emirate } from "@leasing/core";
import type { Database, Tx } from "@leasing/db";
import type { CopilotModel } from "@leasing/copilot";
import type { AgentModel } from "@leasing/helpers";
import type { Transcriber } from "./whisper.ts";
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
  /** TENANCY_OPS: move-in through move-out is on. Off: no renewal/payment/move-out deadlines, routes or inbound types. */
  tenancyOps: boolean;
  /** Outbound email (Nodemailer; a fake in tests). */
  mailer: Mailer;
  /** Generated documents (notice PDFs) under DOCUMENTS_DIR. */
  documents: LocalDiskStore;
  /** Tenant uploads (ID documents) under UPLOADS_DIR. Read only by the KYC helper and staff document views. */
  uploads: LocalDiskStore;
  /** Registration systems by emirate: Ejari (the simulated service in demos, a fake in tests) for Dubai. No entry: staff register by hand. */
  registries: Partial<Record<Emirate, RegistrationAdapter>>;
  /** Local models (decision model for tenant comments). */
  llm: Llm;
  /** Chat model for the leasing assistant (LEASING_ASSISTANT_MODEL). Absent: `llm`. */
  leasingAssistantLlm?: Llm;
  /** Chat model for Contract AI (CONTRACT_AI_MODEL). Absent: `llm`. */
  contractAiLlm?: Llm;
  /** Seconds each Contract AI model call may take (BACKGROUND_MODEL_TIMEOUT_SECONDS); sets the reading jobs' budget. */
  backgroundModelTimeoutSeconds?: number;
  /** Local whisper.cpp server for voice input (VOICE_URL). Absent: voice input is off. */
  transcriber?: Transcriber;
  /** Public base URL of the web app, for links in emails. */
  webUrl: string;
  /** Server HMAC secret (SESSION_SECRET). Domain-separated uses: staff sessions, web-chat email codes (D34). */
  serverSecret: string;
  /** Staff copilot chat model (tool calling). Absent: the chat endpoint answers 503. */
  copilot?: CopilotModel;
  /** Public web chat agent (decision D36): the chat model behind free text. Absent: free text goes to the Leasing Assistant, as on Telegram. */
  customerAgent?: AgentModel;
  /** Chat model with tools behind the contract agent (D45): CONTRACT_AI_MODEL, else CHAT_MODEL. Absent: code path. */
  contractAgent?: AgentModel;
  /** Web chat agent limits: a per-turn deadline (default 60 s) and how many turns run at once (default 2). */
  customerAgentLimits?: { deadlineMs?: number; maxConcurrent?: number };
  /** KYC timing: per-document model time limit and how long a check may run before it shows as stuck. Defaults 120 s and 10 min. */
  kyc?: { docTimeoutMs?: number; stuckMinutes?: number };
  /** Sends an officer's reply into a Telegram enquiry chat. Absent: staff replies answer 503. */
  channel?: ChannelSender;
}
