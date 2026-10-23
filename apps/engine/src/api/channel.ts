import { createHash, timingSafeEqual } from "node:crypto";
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
import { type AuthEnv, requireRole } from "./auth.ts";

const OFFICERS: StaffRole[] = ["leasing_officer", "leasing_manager", "admin"];

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time compare of fixed-length digests, so the secret's length doesn't leak either. */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The Telegram bot's route (decision D24): `POST /channel/telegram/updates`, outside the staff
 * session, authenticated with `CHANNEL_SECRET`. The reply in the response is for the chat the
 * update came from; the bot sends it there and nowhere else. Without a secret the route is off.
 */
export function registerChannelRoutes(app: Hono<AuthEnv>, ctx: EngineContext, secret: string | undefined) {
  app.post("/channel/telegram/updates", async (c) => {
    if (!secret) return c.json({ error: "channel disabled", code: "channel_disabled" }, 503);
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ") || !sameSecret(header.slice(7), secret))
      return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    const update = ChannelUpdate.parse(await c.req.json());
    // The union also holds web updates; those come only from the customer chat route.
    if (update.channel !== "telegram") return c.json({ error: "telegram updates only", code: "bad_channel" }, 400);
    return c.json(await handleChannelUpdate(ctx, update));
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
