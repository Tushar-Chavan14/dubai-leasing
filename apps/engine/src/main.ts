import { loadEnv } from "@leasing/core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpEjariClient, LocalDiskStore, NodemailerMailer, TelegramSender } from "@leasing/adapters";
import { ollamaCopilotModel } from "@leasing/copilot";
import { ModelGate, OllamaLlm } from "@leasing/llm";
import { createDatabase } from "@leasing/db";
import { activeRulesVersion } from "@leasing/rulebook";
import { createApi } from "./api/app.ts";
import { createEngineClock, EngineDemoClock } from "./clock.ts";
import type { EngineContext } from "./context.ts";
import { customerAgentModel } from "./customer-agent-model.ts";
import { bossScheduler, createBoss, requestSweep, startWorkers } from "./jobs.ts";
import { backfillTenancySchedules } from "./manager/milestones.ts";
import { syncRulebooks } from "./manager/rulebooks.ts";

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const clock = await createEngineClock(database, env.DEMO_MODE);
const demoClock = clock instanceof EngineDemoClock ? clock : undefined;
// Store the code rulebook as the base version and load every published version (D23).
await syncRulebooks(database);

const boss = createBoss(env.DATABASE_URL);
boss.on("error", (e) => console.error("pg-boss:", e.message));
await boss.start();

// Relative storage dirs are taken from the repo root (scripts run from apps/engine).
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const uploadsRoot = resolve(repoRoot, env.UPLOADS_DIR);
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const mediaRoot = resolve(repoRoot, env.MEDIA_DIR);
const documentsRoot = resolve(repoRoot, env.DOCUMENTS_DIR);
for (const [name, dir] of [
  ["MEDIA_DIR", mediaRoot],
  ["DOCUMENTS_DIR", documentsRoot],
] as const) {
  if (overlaps(dir, uploadsRoot)) throw new Error(`${name} must not overlap UPLOADS_DIR (tenant documents)`);
}
const mediaStore = new LocalDiskStore(mediaRoot);

// Checked before the mailer exists, so nothing has started connecting.
if (env.DEMO_MODE && env.MAIL_TRANSPORT === "smtp" && !env.MAIL_DEMO_RECIPIENT && env.SMTP_HOST) {
  throw new Error("MAIL_DEMO_RECIPIENT is required in demo mode with real SMTP");
}
const mailer = new NodemailerMailer({
  transport: env.MAIL_TRANSPORT,
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user: env.SMTP_USER,
  pass: env.SMTP_PASS,
  from: env.MAIL_FROM ?? env.SMTP_USER ?? "leasing-demo@example.com",
  // Demo tenants are fictional: in demo mode every email goes to the demo inbox.
  demoRecipient: env.DEMO_MODE ? env.MAIL_DEMO_RECIPIENT : undefined,
});

// Only the simulated registry exists so far; live DLD access is a later phase (architecture §9).
if (env.EJARI_MODE !== "mock") throw new Error("EJARI_MODE=live is not available yet; use mock");

const sessionSecret = env.SESSION_SECRET ?? "demo-only-session-secret";
// One GPU: interactive model calls go before background ones (decision in docs/architecture.md §5).
const modelGate = new ModelGate(1);
const ctx: EngineContext = {
  database,
  clock,
  scheduler: bossScheduler(boss),
  /** The published version in force today (D23); RULES_VERSION only if none is. */
  get rulesVersion() {
    return activeRulesVersion(clock.today()) ?? env.RULES_VERSION;
  },
  demoMode: env.DEMO_MODE,
  tenancyOps: env.TENANCY_OPS,
  mailer,
  documents: new LocalDiskStore(documentsRoot),
  uploads: new LocalDiskStore(uploadsRoot),
  ejari: new HttpEjariClient({ baseUrl: env.EJARI_MOCK_URL }),
  llm: new OllamaLlm({
    url: env.OLLAMA_URL,
    decisionModel: env.DECISION_MODEL,
    chatModel: env.CHAT_MODEL,
    visionModel: env.VISION_MODEL,
    gate: modelGate,
    priority: "interactive",
  }),
  ...(env.LEASING_ASSISTANT_MODEL
    ? {
        leasingAssistantLlm: new OllamaLlm({
          url: env.OLLAMA_URL,
          decisionModel: env.DECISION_MODEL,
          chatModel: env.LEASING_ASSISTANT_MODEL,
          gate: modelGate,
          priority: "interactive",
        }),
      }
    : {}),
  // Contract AI jobs are background work: they queue behind interactive calls and each call is time-limited.
  ...(env.CONTRACT_AI_MODEL || env.CHAT_MODEL
    ? {
        contractAiLlm: new OllamaLlm({
          url: env.OLLAMA_URL,
          chatModel: env.CONTRACT_AI_MODEL || env.CHAT_MODEL,
          visionModel: env.VISION_MODEL,
          gate: modelGate,
          priority: "background",
          defaultTimeoutMs: env.BACKGROUND_MODEL_TIMEOUT_SECONDS * 1000,
        }),
      }
    : {}),
  kyc: { docTimeoutMs: env.KYC_DOC_TIMEOUT_SECONDS * 1000, stuckMinutes: env.KYC_STUCK_MINUTES },
  ...(env.COPILOT_MODEL || env.CHAT_MODEL
    ? { copilot: ollamaCopilotModel({ url: env.OLLAMA_URL, model: (env.COPILOT_MODEL || env.CHAT_MODEL)! }) }
    : {}),
  // Web chat free text (D36): CUSTOMER_AGENT_MODEL, else CHAT_MODEL. Local Ollama only.
  ...(env.CUSTOMER_AGENT_MODEL || env.CHAT_MODEL
    ? {
        customerAgent: customerAgentModel({
          url: env.OLLAMA_URL,
          model: (env.CUSTOMER_AGENT_MODEL || env.CHAT_MODEL)!,
        }),
      }
    : {}),
  customerAgentLimits: { maxConcurrent: env.CUSTOMER_AGENT_MAX_CONCURRENT },
  voiceModel: env.VOICE_MODEL,
  webUrl: env.WEB_URL,
  serverSecret: sessionSecret,
  // Officers' replies in handed-off Telegram enquiries (the bot app receives updates).
  ...(env.TELEGRAM_BOT_TOKEN ? { channel: new TelegramSender(env.TELEGRAM_BOT_TOKEN) } : {}),
};

await startWorkers(boss, ctx, {
  onSweep: () => demoClock?.refresh() ?? Promise.resolve(),
  backgroundModelTimeoutSeconds: env.BACKGROUND_MODEL_TIMEOUT_SECONDS,
});
// After startWorkers: it creates the queues the backfill sends deadline jobs to.
if (ctx.tenancyOps) {
  const filled = await backfillTenancySchedules(ctx);
  if (filled) console.log(`TENANCY_OPS backfill: scheduled ${filled} active lease(s)`);
}
await requestSweep(boss);

let sweepTimer: ReturnType<typeof setInterval> | undefined;
if (env.DEMO_MODE) {
  // Demo: deadlines are driven by the sweep every 30 s (and on every fast-forward).
  sweepTimer = setInterval(() => void requestSweep(boss).catch((e) => console.error("sweep:", e.message)), 30_000);
}

if (env.TELEGRAM_BOT_TOKEN && !env.CHANNEL_SECRET)
  console.warn("CHANNEL_SECRET not set: the Telegram bot route is off");
const app = createApi(ctx, {
  sessionSecret,
  mediaStore,
  channelSecret: env.CHANNEL_SECRET,
  ejariMockUrl: env.EJARI_MOCK_URL,
  ...(demoClock ? { demoClock } : {}),
});
// Copilot answers stream for up to a minute on small GPUs; Bun's default 10 s idle timeout
// would cut them (the stream also sends a heartbeat every few seconds).
const server = Bun.serve({ port: env.ENGINE_PORT, fetch: app.fetch, idleTimeout: 120 });
console.log(
  `engine listening on :${server.port} (demo=${env.DEMO_MODE}, today=${clock.today()}, mail=${env.MAIL_TRANSPORT}${env.DEMO_MODE && env.MAIL_DEMO_RECIPIENT ? " → demo inbox" : ""})`,
);

async function shutdown() {
  clearInterval(sweepTimer);
  server.stop();
  await boss.stop({ graceful: true });
  await database.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
