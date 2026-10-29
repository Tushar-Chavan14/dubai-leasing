import {
  type CopilotEvent,
  type HistoryMessage,
  inProcessClient,
  type PageContext,
  type RequestHandler,
  runCopilotTurn,
  type ToolRecord,
  verifyAnswer,
} from "@leasing/copilot";
import { maskPii, maskPiiText, newId } from "@leasing/core";
import { approvals, copilotMessages, copilotThreads, leases, units } from "@leasing/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { DomainError, notFound } from "../errors.ts";
import {
  ACTION_KINDS,
  cancelProposal,
  confirmProposal,
  getOwnProposal,
  proposalView,
  proposeAction,
  proposeApplication,
  proposeOther,
  threadProposals,
} from "../manager/copilot-proposals.ts";
import { readVoiceBody, transcribeVoice } from "../manager/voice.ts";
import { ipLimiter } from "./secret-gate.ts";
import { createDraft, draftView, threadDrafts } from "../manager/staff-messages.ts";
import type { AuthEnv } from "./auth.ts";

/** The chat route passes the thread to the in-process client so a proposal lands in it. */
export const COPILOT_THREAD_HEADER = "x-copilot-thread";
/** Tools whose output names a proposal (shown as a Confirm card) or a draft (shown as a draft card). */
const PROPOSE_TOOLS = new Set([
  "propose_application",
  "create_task",
  "propose_approval",
  "propose_viewing_invite",
  "propose_request_documents",
  "propose_resend_signing_link",
  "propose_prepare_contract",
]);
const DRAFT_TOOLS = new Set(["draft_email", "draft_approval_note"]);

const ChatRequest = z.object({
  threadId: z.uuid().optional(),
  message: z.string().trim().min(1).max(2000),
  context: z.object({ kind: z.enum(["lease", "unit", "approval"]), id: z.uuid() }).optional(),
});

/** Events on the wire (NDJSON): the graph's events plus the turn's outcome. */
export type ChatStreamEvent =
  | CopilotEvent
  | { type: "thread"; threadId: string }
  | { type: "done"; messageId: string; answer: string; unverified: string[] }
  | { type: "error"; error: string }
  /** Keeps the connection open while the model is thinking; clients ignore it. */
  | { type: "ping" }
  /** The copilot proposed an action; the user confirms or cancels it in the chat (D25). */
  | { type: "proposal"; proposal: ReturnType<typeof proposalView> }
  /** The copilot drafted text; the user opens it in the normal form (D26). */
  | { type: "draft"; draft: ReturnType<typeof draftView> };

/**
 * Staff copilot chat (architecture §8b). The copilot runs as the signed-in user: its tools call
 * this same API in-process with the user's own session token, so every route and role check
 * applies. Tools read, and one proposes (D25): its proposal is carried out only by the user's
 * Confirm click. Each turn is stored for audit in copilot_threads/messages.
 */
export function registerCopilotRoutes(api: Hono<AuthEnv>, ctx: EngineContext, app: RequestHandler) {
  const db = ctx.database.db;

  async function pageLabel(page: PageContext): Promise<string | undefined> {
    if (page.kind === "lease") {
      const [r] = await db
        .select({ ref: leases.ref, code: units.code })
        .from(leases)
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(eq(leases.id, page.id));
      return r ? `${r.code} (lease ${r.ref})` : undefined;
    }
    if (page.kind === "unit") {
      const [u] = await db.select({ code: units.code }).from(units).where(eq(units.id, page.id));
      return u?.code;
    }
    const [a] = await db.select({ title: approvals.title }).from(approvals).where(eq(approvals.id, page.id));
    return a ? `"${a.title}"` : undefined;
  }

  /** Staff voice to text: 60 per user per hour; the audio is read in memory and dropped. */
  const voiceLimited = ipLimiter(60);
  api.post("/voice/transcribe", async (c) => {
    if (voiceLimited(c.get("user").id))
      return c.json({ error: "Too many recordings; try again later.", code: "rate_limited" }, 429);
    const read = await readVoiceBody(c.req.raw);
    if ("error" in read) return c.json({ error: read.error, code: read.code }, read.status);
    const bytes = read.bytes;
    if (bytes.length === 0) return c.json({ ok: false, message: "I didn't catch that. Please try again." });
    return c.json(await transcribeVoice(ctx, bytes));
  });

  api.post("/copilot/chat", async (c) => {
    const user = c.get("user");
    const body = ChatRequest.parse(await c.req.json());
    // Personal identifiers never reach the model or the stored conversation (rule 8).
    const message = maskPiiText(body.message);
    if (!ctx.copilot)
      throw new DomainError("The copilot isn't configured (COPILOT_MODEL or CHAT_MODEL).", 503, "copilot_off");
    const model = ctx.copilot;
    const token = (c.req.header("authorization") ?? "").slice(7);

    let threadId = body.threadId;
    let history: HistoryMessage[] = [];
    if (threadId) {
      const [t] = await db
        .select()
        .from(copilotThreads)
        .where(and(eq(copilotThreads.id, threadId), eq(copilotThreads.userId, user.id)));
      if (!t) throw notFound("conversation");
      const prior = await db
        .select({ role: copilotMessages.role, content: copilotMessages.content })
        .from(copilotMessages)
        .where(and(eq(copilotMessages.threadId, t.id), inArray(copilotMessages.role, ["user", "assistant"])))
        .orderBy(desc(copilotMessages.at))
        .limit(8);
      history = prior.toReversed().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    } else {
      threadId = newId();
      await db.insert(copilotThreads).values({
        id: threadId,
        userId: user.id,
        contextKind: body.context?.kind ?? null,
        contextId: body.context?.id ?? null,
        title: message.slice(0, 80),
        createdAt: ctx.clock.now(),
      });
    }
    let page: PageContext | undefined;
    if (body.context) {
      const label = await pageLabel(body.context);
      page = { ...body.context, ...(label ? { label } : {}) };
    }
    const startedAt = ctx.clock.now().getTime();
    await db.insert(copilotMessages).values({
      id: newId(),
      threadId,
      role: "user",
      content: message,
      at: new Date(startedAt),
    });

    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    return stream(c, async (s) => {
      let chain = Promise.resolve();
      const send = (e: ChatStreamEvent) => {
        chain = chain.then(() => s.write(`${JSON.stringify(e)}\n`)).then(() => undefined);
      };
      send({ type: "thread", threadId: threadId! });
      const heartbeat = setInterval(() => send({ type: "ping" }), 5000);
      const t0 = performance.now();
      const today = ctx.clock.today();
      // Each tool call is stored as soon as it completes, so the audit keeps it even if the
      // turn fails afterwards. Arguments and errors are masked like everything else stored.
      let seq = 0;
      let stored = Promise.resolve();
      const storeTool = (t: ToolRecord) => {
        const at = new Date(startedAt + 1 + seq++);
        if (t.ok && PROPOSE_TOOLS.has(t.name)) {
          const id = (t.output as { proposalId?: unknown } | null)?.proposalId;
          if (typeof id === "string") {
            // Its own chain: a failed lookup must never skip storing the tool call below.
            void getOwnProposal(ctx, user, id)
              .then((proposal) => proposal && send({ type: "proposal", proposal }))
              .catch((e: unknown) => console.error(`copilot proposal event: ${maskPiiText(String(e))}`));
          }
        }
        if (t.ok && DRAFT_TOOLS.has(t.name)) {
          const id = (t.output as { draftId?: unknown } | null)?.draftId;
          if (typeof id === "string") {
            void threadDrafts(ctx, threadId!)
              .then((ds) => {
                const draft = ds.find((d) => d.id === id);
                if (draft) send({ type: "draft", draft });
              })
              .catch((e: unknown) => console.error(`copilot draft event: ${maskPiiText(String(e))}`));
          }
        }
        stored = stored.then(async () => {
          await db.insert(copilotMessages).values({
            id: newId(),
            threadId: threadId!,
            role: "tool",
            content: t.ok ? "" : maskPiiText(t.content).slice(0, 500),
            toolName: t.name,
            toolArgs: maskPii(t.args),
            toolResultSha256: t.resultSha256,
            toolOk: t.ok,
            at,
          });
        });
      };
      try {
        const turn = await runCopilotTurn({
          model,
          ctx: { engine: inProcessClient(app, token, { threadId: threadId! }), user, today },
          message,
          history,
          ...(page ? { page } : {}),
          onEvent: send,
          onTool: storeTool,
          tenancyOps: ctx.tenancyOps,
        });
        await stored;
        const latencyMs = Math.round(performance.now() - t0);
        const answer = maskPiiText(turn.answer);
        const check = verifyAnswer(answer, [...turn.tools.map((t) => t.output), message, today]);
        const messageId = newId();
        await db.insert(copilotMessages).values({
          id: messageId,
          threadId: threadId!,
          role: "assistant",
          content: answer,
          unverified: check.unverified,
          model: turn.model,
          latencyMs,
          at: new Date(startedAt + 2 + seq),
        });
        send({ type: "done", messageId, answer, unverified: check.unverified });
      } catch (e) {
        const error = maskPiiText(e instanceof Error ? e.message : String(e));
        console.error(`copilot turn failed: ${error}`);
        await stored.catch(() => {});
        send({
          type: "error",
          error: "The copilot couldn't answer just now. Try again, or check that Ollama is running.",
        });
      }
      clearInterval(heartbeat);
      await chain;
    });
  });

  api.get("/copilot/threads", async (c) =>
    c.json(
      await db
        .select({
          id: copilotThreads.id,
          title: copilotThreads.title,
          contextKind: copilotThreads.contextKind,
          contextId: copilotThreads.contextId,
          createdAt: copilotThreads.createdAt,
        })
        .from(copilotThreads)
        .where(eq(copilotThreads.userId, c.get("user").id))
        .orderBy(desc(copilotThreads.createdAt))
        .limit(30),
    ),
  );

  api.get("/copilot/threads/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    const [t] = id.success
      ? await db
          .select()
          .from(copilotThreads)
          .where(and(eq(copilotThreads.id, id.data), eq(copilotThreads.userId, c.get("user").id)))
      : [];
    if (!t) throw notFound("conversation");
    const messages = await db
      .select({
        id: copilotMessages.id,
        role: copilotMessages.role,
        content: copilotMessages.content,
        toolName: copilotMessages.toolName,
        toolArgs: copilotMessages.toolArgs,
        toolOk: copilotMessages.toolOk,
        unverified: copilotMessages.unverified,
        at: copilotMessages.at,
      })
      .from(copilotMessages)
      .where(eq(copilotMessages.threadId, t.id))
      .orderBy(asc(copilotMessages.at));
    return c.json({
      ...t,
      messages,
      proposals: await threadProposals(ctx, t.id),
      drafts: await threadDrafts(ctx, t.id),
    });
  });

  // --- proposals (decision D25) ---
  /** Stores a proposal in the caller's thread. Creates nothing: only Confirm does. */
  api.post("/copilot/proposals", async (c) => {
    const threadId = z.uuid().safeParse(c.req.header(COPILOT_THREAD_HEADER));
    if (!threadId.success) throw new DomainError("proposals are made from a copilot conversation", 400, "no_thread");
    const body = (await c.req.json()) as { kind?: string };
    // No kind: an application (D25). Tasks and approval requests name theirs (D26), and so do
    // the four engine actions (D42).
    if (ACTION_KINDS.includes(body.kind as (typeof ACTION_KINDS)[number]))
      return c.json(await proposeAction(ctx, c.get("user"), threadId.data, body), 201);
    if (body.kind === "create_task" || body.kind === "request_approval")
      return c.json(await proposeOther(ctx, c.get("user"), threadId.data, body), 201);
    const { kind: _k, ...rest } = body as Record<string, unknown>;
    return c.json(
      await proposeApplication(ctx, c.get("user"), threadId.data, body.kind === "create_application" ? rest : body),
      201,
    );
  });
  /** Saves a copilot draft in the caller's thread. Sends nothing. */
  api.post("/copilot/drafts", async (c) => {
    const threadId = z.uuid().safeParse(c.req.header(COPILOT_THREAD_HEADER));
    if (!threadId.success) throw new DomainError("drafts are made from a copilot conversation", 400, "no_thread");
    return c.json(await createDraft(ctx, c.get("user"), threadId.data, await c.req.json()), 201);
  });
  /** The user's Confirm click (staff UI only; not reachable from the copilot's client). */
  api.post("/copilot/proposals/:id/confirm", async (c) =>
    c.json(await confirmProposal(ctx, c.get("user"), z.uuid().parse(c.req.param("id")))),
  );
  api.post("/copilot/proposals/:id/cancel", async (c) =>
    c.json(await cancelProposal(ctx, c.get("user"), z.uuid().parse(c.req.param("id")))),
  );
}
