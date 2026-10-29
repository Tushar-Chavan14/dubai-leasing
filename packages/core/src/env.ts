import { z } from "zod";

/**
 * Environment, validated once at startup. Empty strings count as "not set" so `.env` lines
 * like `VISION_MODEL=` behave as unset. Inline `# comments` after a value are stripped.
 */
const clean = (v: unknown) => {
  if (typeof v !== "string") return v;
  const s = v.replace(/\s+#.*$/, "").trim();
  return s === "" ? undefined : s;
};

const str = () => z.preprocess(clean, z.string());
const optStr = () => z.preprocess(clean, z.string().optional());
const bool = (def: boolean) =>
  z.preprocess((v) => {
    const c = clean(v);
    return c === undefined ? def : c === "true" || c === "1";
  }, z.boolean());
const int = (def: number) => z.preprocess((v) => clean(v) ?? def, z.coerce.number().int());

export const EnvSchema = z.object({
  DATABASE_URL: str().pipe(z.string().startsWith("postgres")),
  TEST_DATABASE_URL: optStr(),

  OLLAMA_URL: z.preprocess((v) => clean(v) ?? "http://localhost:11434", z.string().url()),
  CHAT_MODEL: optStr(),
  VISION_MODEL: optStr(),
  /** Voice input (audio-capable, local Ollama only). */
  VOICE_MODEL: z.preprocess(clean, z.string().default("gemma4:e4b")),
  DECISION_MODEL: optStr(),
  COPILOT_MODEL: optStr(),
  /** Leasing assistant (enquiry answers). Empty = CHAT_MODEL. */
  LEASING_ASSISTANT_MODEL: optStr(),
  /** Contract AI (contract-template and contract-structure helpers). Empty = CHAT_MODEL. */
  CONTRACT_AI_MODEL: optStr(),
  /** Public web chat agent (tool calling, local only). Empty = CHAT_MODEL. */
  CUSTOMER_AGENT_MODEL: optStr(),
  /** Visitor messages the agent works on at once; more get a "busy" reply (in memory, per engine process). */
  CUSTOMER_AGENT_MAX_CONCURRENT: int(2),
  /** KYC: one document reading is cancelled after this long; it gets one retry, then a person is told. */
  KYC_DOC_TIMEOUT_SECONDS: z.preprocess((v) => clean(v) ?? 120, z.coerce.number().int().min(5).max(900)),
  /** KYC: a check still running after this long shows "didn't finish" with a retry button. */
  KYC_STUCK_MINUTES: z.preprocess((v) => clean(v) ?? 10, z.coerce.number().int().min(1).max(240)),
  /** Contract AI jobs (background) cancel one model call after this long so they can't hold the GPU. */
  BACKGROUND_MODEL_TIMEOUT_SECONDS: z.preprocess((v) => clean(v) ?? 300, z.coerce.number().int().min(30).max(1800)),

  TELEGRAM_BOT_TOKEN: optStr(),
  TELEGRAM_MODE: z.preprocess((v) => clean(v) ?? "polling", z.enum(["polling", "webhook"])),
  TELEGRAM_WEBHOOK_URL: optStr(),
  /** Checked on every webhook call (Telegram's secret_token header). Required in webhook mode. */
  TELEGRAM_WEBHOOK_SECRET: optStr(),
  /** Port the bot listens on in webhook mode (behind the HTTPS proxy). */
  TELEGRAM_WEBHOOK_PORT: int(4200),
  /** Shared secret between the Telegram bot and the engine's channel route (≥ 32 chars). Unset: the route is off. */
  CHANNEL_SECRET: z.preprocess(clean, z.string().min(32).optional()),

  EJARI_MODE: z.preprocess((v) => clean(v) ?? "mock", z.enum(["mock", "live"])),
  EJARI_MOCK_URL: z.preprocess((v) => clean(v) ?? "http://localhost:4100", z.string().url()),
  MOCK_EJARI_FAILURE_RATE: z.preprocess((v) => clean(v) ?? 0, z.coerce.number().min(0).max(1)),

  ENGINE_PORT: int(4000),
  ENGINE_URL: z.preprocess((v) => clean(v) ?? "http://localhost:4000", z.string().url()),
  WEB_URL: z.preprocess((v) => clean(v) ?? "http://localhost:3000", z.string().url()),
  TIMEZONE: z.preprocess((v) => clean(v) ?? "Asia/Dubai", z.literal("Asia/Dubai")),
  DEMO_MODE: bool(false),
  /** Move-in through move-out (collections, complaints, renewal, move-out). Off: those routes, jobs and tools are hidden. */
  TENANCY_OPS: bool(false),
  UPLOADS_DIR: z.preprocess((v) => clean(v) ?? "./data/uploads", z.string()),
  /** PDFs the system generates (notices, contracts). Not tenant uploads. */
  DOCUMENTS_DIR: z.preprocess((v) => clean(v) ?? "./data/documents", z.string()),
  /** Demo mode: every email goes here instead of to the (fictional) recipient. */
  MAIL_DEMO_RECIPIENT: z.preprocess(clean, z.string().email().optional()),
  /** Unit marketing photos (not tenant documents). */
  MEDIA_DIR: z.preprocess((v) => clean(v) ?? "./data/media", z.string()),
  RULES_VERSION: z.preprocess((v) => clean(v) ?? "dubai-2025-01", z.string()),
  /** HMAC secret for staff session tokens. Required outside demo mode. */
  SESSION_SECRET: optStr(),

  MAIL_TRANSPORT: z.preprocess((v) => clean(v) ?? "smtp", z.enum(["smtp", "ethereal"])),
  SMTP_HOST: optStr(),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optStr(),
  SMTP_PASS: optStr(),
  MAIL_FROM: optStr(),
  NOTICE_ACK_FOLLOWUP_DAYS: int(5),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;
  if (!env.DEMO_MODE && !env.SESSION_SECRET) {
    throw new Error("Invalid environment:\n  SESSION_SECRET: required when DEMO_MODE is false");
  }
  return env;
}
