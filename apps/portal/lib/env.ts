import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";

/**
 * Portal settings (S25 style, S69). The portal reads only `.env.portal.local` at the repo root, never `.env`,
 * `.env.spa.local` or `process.env`: Bun loads the leasing `.env` into `process.env` on its own, and the portal must
 * share nothing with either module but the summary key. It reaches the modules by URL only.
 */
export const PORTAL_ENV_FILE = ".env.portal.local";
/** The repo root is the nearest folder (from the start up) that holds this file. */
const MARKER = "tsconfig.base.json";

const url = (d: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : d))
    .pipe(z.string().url());
const bool = (d: boolean) =>
  z
    .enum(["true", "false", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? d : v === "true"));

const secret = (min: number) =>
  z
    .string()
    .trim()
    .min(min, `must be at least ${min} characters`)
    .optional()
    .or(z.literal("").transform(() => undefined));
const BASE64 = /^[A-Za-z0-9+/=]{40,200}$/;

export const PortalEnv = z
  .object({
    PORTAL_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    /** Where each tile links to (the module's web app). */
    PORTAL_LEASING_URL: url("http://localhost:3000"),
    PORTAL_SPA_URL: url("http://localhost:3001"),
    /** Where the counts are read (each module's engine). Server side only. */
    PORTAL_LEASING_ENGINE_URL: url("http://localhost:4000"),
    PORTAL_SPA_ENGINE_URL: url("http://localhost:4001"),
    /** Sent as `x-portal-key`; the same value in each engine's own env file. Unset: the engines answer 404. */
    PORTAL_SUMMARY_KEY: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined)),
    /** Demo mode: show each module's two counts. Off (default): the tiles show no numbers (S69). */
    PORTAL_SHOW_COUNTS: bool(false),
    /**
     * Sign-in (S70). Off unless `PORTAL_SIGNING_KEY` is set: the portal then behaves as in C37. The key is the private half
     * of `bun run portal:keygen` (one line of base64); each module holds only the public half.
     */
    PORTAL_SIGNING_KEY: z
      .string()
      .trim()
      .regex(BASE64, "must be the one-line base64 private key from portal:keygen")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** The portal's own database (`portal`), with accounts only. */
    PORTAL_DATABASE_URL: z
      .string()
      .trim()
      .url()
      .refine(
        (v) => /^postgres(ql)?:\/\/[^/]+\/[^/?]*portal[^/?]*(\?.*)?$/.test(v),
        "must be a postgres:// URL to a database whose name contains portal",
      )
      .optional()
      .or(z.literal("").transform(() => undefined)),
    PORTAL_TEST_DATABASE_URL: z
      .string()
      .trim()
      .url()
      .refine((v) => /test/.test(v.split("/").pop() ?? ""), 'database name must contain "test"')
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /** Signs the portal's own session cookie (HMAC). Required with sign-in. */
    PORTAL_SESSION_SECRET: secret(32),
    /** `true` behind HTTPS: the cookie is then marked Secure. */
    PORTAL_SECURE_COOKIE: bool(false),
  })
  .superRefine((e, c) => {
    if (!e.PORTAL_SIGNING_KEY) return;
    for (const k of ["PORTAL_DATABASE_URL", "PORTAL_SESSION_SECRET"] as const)
      if (!e[k]) c.addIssue({ code: "custom", path: [k], message: "required when PORTAL_SIGNING_KEY is set" });
  });
export type PortalEnv = z.infer<typeof PortalEnv>;

/** Validates already-read values. One error lists every bad key; values are never printed. */
export function parsePortalEnv(values: Record<string, string | undefined>): PortalEnv {
  const r = PortalEnv.safeParse(values);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join(".") || "(file)"}: ${i.message}`);
  throw new Error(`Invalid ${PORTAL_ENV_FILE}:\n${lines.join("\n")}`);
}

export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, MARKER))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`can't find the repo root (${MARKER}) above ${start}`);
    dir = up;
  }
}

/** Reads and validates `.env.portal.local`. A missing file means every default; nothing else is read. */
export function loadPortalEnv(root: string = findRepoRoot()): PortalEnv {
  const file = join(root, PORTAL_ENV_FILE);
  return parsePortalEnv(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {});
}

let cached: PortalEnv | null = null;
/** Read once per server process. Server code only: it never reaches the browser. */
export function portalEnv(): PortalEnv {
  cached ??= loadPortalEnv();
  return cached;
}
