import { ChannelUpdate, maskPiiText, type StaffRole } from "@leasing/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import {
  getConversation,
  handleChannelUpdate,
  listConversations,
  releaseConversation,
  staffReply,
} from "../manager/enquiries.ts";
import { readVoiceBody, transcribeVoice } from "../manager/voice.ts";
import { webHistory } from "../manager/web-chat.ts";
import { type AuthEnv, requireRole } from "./auth.ts";
import { clientIp, ipLimiter, secretGate } from "./secret-gate.ts";

const OFFICERS: StaffRole[] = ["leasing_officer", "leasing_manager", "admin"];

const MAX_UPDATES_PER_IP = 200;
const MAX_HISTORY_PER_IP = 3000;
/** Status-check code requests per client IP per hour (D34); the per-email limit is counted in the database. */
const MAX_STATUS_CODES_PER_IP = 20;
/** Voice transcriptions per client IP per hour (public web chat). */
const MAX_VOICE_PER_IP = 20;

/**
 * Channel relays, outside the staff session, authenticated with `CHANNEL_SECRET` (decision D24):
 * `POST /channel/telegram/updates` for the Telegram bot and, for the public web chat,
 * `POST /channel/web/updates` and `POST /channel/web/history`, called by the web server only.
 * The reply in the response is for the chat the update came from. The web server sets the visitor
 * id from its own cookie and forwards the client IP in `x-forwarded-for` for the per-IP limits.
 * Without a secret the routes are off.
 */
export function registerChannelRoutes(app: Hono<AuthEnv>, ctx: EngineContext, secret: string | undefined) {
  const gate = secretGate(secret);
  const updatesLimited = ipLimiter(MAX_UPDATES_PER_IP);
  const historyLimited = ipLimiter(MAX_HISTORY_PER_IP);
  const codesLimited = ipLimiter(MAX_STATUS_CODES_PER_IP);
  const voiceLimited = ipLimiter(MAX_VOICE_PER_IP);

  app.post("/channel/telegram/updates", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    const update = ChannelUpdate.parse(await c.req.json());
    // The union also holds web updates; those come only from the web route.
    if (update.channel !== "telegram") return c.json({ error: "telegram updates only", code: "bad_channel" }, 400);
    return c.json(await handleChannelUpdate(ctx, update));
  });

  app.post("/channel/web/updates", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (updatesLimited(clientIp(c)))
      return c.json({ error: "Too many requests; try again later.", code: "rate_limited" }, 429);
    const update = ChannelUpdate.parse(await c.req.json());
    if (update.channel !== "web") return c.json({ error: "web updates only", code: "bad_channel" }, 400);
    // The visitor id is both the chat and the sender.
    if (update.chatId !== update.from.id) return c.json({ error: "chat and sender differ", code: "bad_visitor" }, 400);
    // A code request may send an email: limited per client IP (same forwarded-address rules as the other limits).
    if (update.kind === "callback" && update.data === "status:start" && codesLimited(clientIp(c)))
      return c.json({ error: "Too many requests; try again later.", code: "rate_limited" }, 429);
    // The agent may email a status code from free text: it draws on the same per-IP budget as the button.
    return c.json(await handleChannelUpdate(ctx, update, { codeQuota: () => !codesLimited(clientIp(c)) }));
  });

  /** Voice to text for the public chat: the audio is read in memory and dropped; the reply is only the masked transcript. */
  app.post("/channel/web/voice", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (voiceLimited(clientIp(c)))
      return c.json({ error: "Too many requests; try again later.", code: "rate_limited" }, 429);
    const read = await readVoiceBody(c.req.raw);
    if ("error" in read) return c.json({ error: read.error, code: read.code }, read.status);
    const bytes = read.bytes;
    if (bytes.length === 0) return c.json({ ok: false, message: "I didn't catch that. Please try again." });
    return c.json(await transcribeVoice(ctx, bytes));
  });

  app.post("/channel/web/history", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (historyLimited(clientIp(c)))
      return c.json({ error: "Too many requests; try again later.", code: "rate_limited" }, 429);
    const body = z
      .object({
        visitorId: z.uuid(),
        after: z.iso
          .datetime({ offset: true })
          .transform((s) => new Date(s))
          .optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await webHistory(ctx, body.visitorId, body.after));
  });
}

/** Staff conversation views: any staff role reads; officers and managers reply or hand back to the bot. */
export function registerConversationRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  api.get("/conversations", async (c) => c.json(await listConversations(ctx)));
  api.get("/conversations/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    const conv = id.success ? await getConversation(ctx, id.data) : null;
    if (!conv) throw notFound("conversation");
    // The full phone number is for the staff who follow up; other roles see it masked.
    const full = OFFICERS.includes(c.get("user").role);
    return c.json({
      ...conv,
      contactPhone: conv.contactPhone && !full ? maskPiiText(conv.contactPhone) : conv.contactPhone,
    });
  });
  api.post("/conversations/:id/reply", async (c) => {
    requireRole(c.get("user"), OFFICERS);
    const id = z.uuid().parse(c.req.param("id"));
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(await c.req.json());
    return c.json(await staffReply(ctx, id, c.get("user"), text));
  });
  api.post("/conversations/:id/release", async (c) => {
    requireRole(c.get("user"), OFFICERS);
    const id = z.uuid().parse(c.req.param("id"));
    return c.json(await releaseConversation(ctx, id, c.get("user")));
  });
}
