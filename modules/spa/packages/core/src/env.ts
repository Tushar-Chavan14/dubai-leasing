import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";

/**
 * SPA settings (decision S25, architecture §11). SPA apps read only `.env.spa.local` at the repo root, never `.env`
 * or `.env.local`, and never `process.env`: Bun loads leasing's `.env` into `process.env` on its own, so leasing
 * values (database, models, Ollama) would leak into SPA. Missing or invalid keys stop the app at start.
 */
export const SPA_ENV_FILE = ".env.spa.local";
/** The committed template; its folder is the repo root. */
const MARKER = ".env.spa.example";

const str = () => z.string().trim();
const opt = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined));
const port = (d: number) => z.coerce.number().int().min(1).max(65535).default(d);
const bool = (d: boolean) =>
  z
    .enum(["true", "false", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? d : v === "true"));

/** The database name in a Postgres URL, or null when the value isn't a URL. Never echoes the value. */
export function databaseName(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}
const pgUrl = () =>
  str()
    .startsWith("postgres", "must be a postgres:// URL")
    .refine((v) => databaseName(v) !== null, "must be a postgres:// URL with a database name");

export const SpaEnv = z
  .object({
    SPA_DATABASE_URL: pgUrl(),
    SPA_TEST_DATABASE_URL: pgUrl()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    SPA_ENGINE_PORT: port(4001),
    SPA_WEB_PORT: port(3001),
    SPA_SESSION_COOKIE: str()
      .regex(/^[a-z_]+$/)
      .default("spa_session"),
    /** Signs session tokens (HMAC). Required outside demo mode (at least 32 characters); demo mode has its own. */
    SPA_SESSION_SECRET: opt(),
    SPA_DEMO_MODE: bool(false),
    /** Where "Portal" in the avatar menu goes (the module chooser, S10). */
    SPA_PORTAL_URL: str().url().default("http://localhost:3100"),
    /**
     * `true` when a reverse proxy you run sits in front of the web app and appends the real visitor address to
     * `x-forwarded-for`: the last hop is then the visitor's bucket for the listing chat's rate limit (S61). Otherwise the
     * header is visitor-supplied, ignored, and every visitor of a listing shares one bucket.
     */
    SPA_TRUSTED_PROXY: bool(false),
    OLLAMA_URL: opt(),
    // Models are fixed here (S25); required once helpers exist (P6).
    SPA_CHAT_MODEL: opt(),
    SPA_VISION_MODEL: opt(),
    SPA_DECISION_MODEL: opt(),
    SPA_COPILOT_MODEL: opt(),
    SPA_ASSISTANT_MODEL: opt(),
    /** The simulated Oqood and trustee registry (S53). Only demo and test use it; a real registry's adapter comes later. */
    REGISTRY_MOCK_URL: str().url().default("http://localhost:4101"),
    /** 0..1: share of requests the mock answers "temporarily unavailable" (503), to show retries in demos. */
    REGISTRY_MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
    /** Outbound mail (rule 10, S54). `ethereal` is a throwaway dev inbox; `smtp` needs SMTP_HOST. */
    MAIL_TRANSPORT: z.enum(["ethereal", "smtp"]).default("ethereal"),
    SMTP_HOST: opt(),
    SMTP_PORT: port(465),
    SMTP_SECURE: bool(true),
    SMTP_USER: opt(),
    SMTP_PASS: opt(),
    SPA_MAIL_FROM: str().default("SPA Sales <no-reply@spa.example.test>"),
    /** Demo mode with real SMTP: every message goes to this inbox instead of its recipient (fictional people). */
    SPA_MAIL_DEMO_RECIPIENT: opt(),
    /** Where the buyer pages live (links in mail are `<SPA_WEB_URL>/b/<token>/...`). Default: the SPA web port. */
    SPA_WEB_URL: opt(),
    /** Shared with the launcher (S69): `GET /summary` answers only when `x-portal-key` equals it. Unset: the route is off (404). */
    PORTAL_SUMMARY_KEY: z
      .string()
      .trim()
      .min(16, "must be at least 16 characters")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** The portal's public key (one line of base64, S70). Unset: portal sign-in is off; the app's own sign-in stays. */
    SPA_PORTAL_PUBLIC_KEY: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9+/=]{40,200}$/, "must be the one-line base64 public key from portal:keygen")
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((e, c) => {
    if (e.MAIL_TRANSPORT === "smtp" && !e.SMTP_HOST)
      c.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "required when MAIL_TRANSPORT is smtp" });
    if (e.SPA_DEMO_MODE && e.MAIL_TRANSPORT === "smtp" && !e.SPA_MAIL_DEMO_RECIPIENT)
      c.addIssue({
        code: "custom",
        path: ["SPA_MAIL_DEMO_RECIPIENT"],
        message: "required with SPA_DEMO_MODE=true and real SMTP (demo people are fictional)",
      });
    if (e.SPA_TEST_DATABASE_URL && !/test/.test(databaseName(e.SPA_TEST_DATABASE_URL) ?? ""))
      c.addIssue({ code: "custom", path: ["SPA_TEST_DATABASE_URL"], message: 'database name must contain "test"' });
    if (e.SPA_TEST_DATABASE_URL && e.SPA_TEST_DATABASE_URL === e.SPA_DATABASE_URL)
      c.addIssue({ code: "custom", path: ["SPA_TEST_DATABASE_URL"], message: "must differ from SPA_DATABASE_URL" });
    if (!e.SPA_DEMO_MODE && (e.SPA_SESSION_SECRET?.length ?? 0) < 32)
      c.addIssue({
        code: "custom",
        path: ["SPA_SESSION_SECRET"],
        message: "required when SPA_DEMO_MODE is false (at least 32 characters)",
      });
    if (e.SPA_ENGINE_PORT === e.SPA_WEB_PORT)
      c.addIssue({ code: "custom", path: ["SPA_WEB_PORT"], message: "must differ from SPA_ENGINE_PORT" });
  });
export type SpaEnv = z.infer<typeof SpaEnv>;

/**
 * Demo mode signs sessions with a fixed secret when none is set, like leasing (S33). It differs from leasing's, so a
 * leasing session never opens SPA. Outside demo mode the env schema requires a real one.
 */
export const SPA_DEMO_SESSION_SECRET = "spa-demo-only-session-secret";
export const sessionSecret = (env: SpaEnv): string => env.SPA_SESSION_SECRET ?? SPA_DEMO_SESSION_SECRET;

/** Validates already-read values. Throws one error that lists every bad key (values are never printed). */
export function parseSpaEnv(values: Record<string, string | undefined>): SpaEnv {
  const r = SpaEnv.safeParse(values);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join(".") || "(file)"}: ${i.message}`);
  throw new Error(`Invalid ${SPA_ENV_FILE}:\n${lines.join("\n")}`);
}

/** The repo root: the nearest folder (from `start` up) holding `.env.spa.example`. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, MARKER))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`can't find the repo root (${MARKER}) above ${start}`);
    dir = up;
  }
}

/** Reads and validates `.env.spa.local` from the repo root. Nothing else is read. */
export function loadSpaEnv(root: string = findRepoRoot()): SpaEnv {
  const file = join(root, SPA_ENV_FILE);
  if (!existsSync(file)) throw new Error(`Missing ${SPA_ENV_FILE} at ${root}: copy ${MARKER} and fill it in.`);
  return parseSpaEnv(parseEnv(readFileSync(file, "utf8")));
}
