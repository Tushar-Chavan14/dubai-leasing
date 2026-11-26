import { describe, expect, test } from "bun:test";
import type { ChannelReply, ChannelUpdate } from "@leasing/core";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { enginePoster, installRelay } from "../src/relay.ts";

type Call = { method: string; payload: Record<string, unknown> };

/** A bot whose Bot API calls are recorded instead of sent. */
function testBot(post: (u: ChannelUpdate) => Promise<ChannelReply | null>) {
  const bot = new Bot("123:test", {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "Enquiries",
      username: "enquiry_test_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    } as never,
  });
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: method === "sendMessage" ? { message_id: calls.length } : true } as never;
  });
  const logs: string[] = [];
  installRelay(bot, post, (l) => logs.push(l));
  return { bot, calls, logs };
}

let n = 1;
const user = (id: number, lang = "en") => ({ id, is_bot: false, first_name: "Test", language_code: lang });
const privateChat = (id: number) => ({ id, type: "private" as const, first_name: "Test" });
const textUpdate = (chatId: number, text: string, extra: Record<string, unknown> = {}): Update => ({
  update_id: n++,
  message: { message_id: n, date: 0, chat: privateChat(chatId), from: user(chatId), text, ...extra } as never,
});

describe("relay", () => {
  test("text and commands go to the engine; the reply goes back to that same chat with buttons", async () => {
    const seen: ChannelUpdate[] = [];
    const { bot, calls } = testBot(async (u) => {
      seen.push(u);
      return { text: `for ${u.chatId}`, buttons: [{ label: "1 bedroom", data: "bed:1" }] };
    });
    await bot.handleUpdate(textUpdate(111, "any 1 bed?"));
    await bot.handleUpdate(textUpdate(222, "/units@enquiry_test_bot"));
    await bot.handleUpdate(textUpdate(222, "/unknowncommand"));
    expect(seen.map((u) => [u.chatId, u.kind, "text" in u ? u.text : "command" in u ? u.command : ""])).toEqual([
      ["111", "text", "any 1 bed?"],
      ["222", "command", "units"],
      ["222", "command", "help"],
    ]);
    const sends = calls.filter((c) => c.method === "sendMessage");
    expect(sends.map((c) => [c.payload.chat_id, c.payload.text])).toEqual([
      [111, "for 111"],
      [222, "for 222"],
      [222, "for 222"],
    ]);
    expect(JSON.parse(JSON.stringify(sends[0]!.payload.reply_markup))).toEqual({
      inline_keyboard: [[{ text: "1 bedroom", callback_data: "bed:1" }]],
    });
  });

  test("button taps are acknowledged and relayed as callbacks", async () => {
    const seen: ChannelUpdate[] = [];
    const { bot, calls } = testBot(async (u) => (seen.push(u), null));
    await bot.handleUpdate({
      update_id: n++,
      callback_query: {
        id: "cb1",
        from: user(333),
        chat_instance: "x",
        data: "bed:2",
        message: { message_id: 5, date: 0, chat: privateChat(333), text: "pick" } as never,
      },
    });
    expect(seen[0]).toMatchObject({ kind: "callback", data: "bed:2", chatId: "333" });
    expect(calls.map((c) => c.method)).toEqual(["answerCallbackQuery"]);
  });

  test("photos are relayed as media only (no file); forwards and group messages are not relayed", async () => {
    const seen: ChannelUpdate[] = [];
    const { bot, calls } = testBot(async (u) => (seen.push(u), null));
    await bot.handleUpdate({
      update_id: n++,
      message: { message_id: 1, date: 0, chat: privateChat(444), from: user(444), photo: [{ file_id: "F" }] } as never,
    });
    await bot.handleUpdate(
      textUpdate(444, "fwd", { forward_origin: { type: "hidden_user", date: 0, sender_user_name: "x" } }),
    );
    await bot.handleUpdate({
      update_id: n++,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: -100, type: "group", title: "g" },
        from: user(444),
        text: "hi",
      } as never,
    });
    expect(seen).toEqual([expect.objectContaining({ kind: "media", chatId: "444" })]);
    expect(JSON.stringify(seen)).not.toContain("F");
    expect(calls.map((c) => c.method)).toEqual(["leaveChat"]);
  });

  test("engine down: a short apology in the customer's language; nothing about the message in the log", async () => {
    const { bot, calls, logs } = testBot(async () => {
      throw new Error("engine unreachable (TypeError)");
    });
    await bot.handleUpdate({
      update_id: n++,
      message: {
        message_id: 1,
        date: 0,
        chat: privateChat(5550123),
        from: user(5550123, "ar"),
        text: "my phone is 0501234567",
      } as never,
    });
    expect(String(calls[0]!.payload.text)).toContain("عذراً");
    expect(logs.join(" ")).not.toContain("0501234567");
    expect(logs.join(" ")).not.toContain("5550123");
  });
});

describe("enginePoster", () => {
  const update: ChannelUpdate = {
    channel: "telegram",
    updateId: "1",
    chatId: "1",
    from: { id: "1" },
    kind: "command",
    command: "start",
  };
  test("sends the secret and returns the reply", async () => {
    let auth = "";
    const post = enginePoster({
      engineUrl: "http://engine.test",
      secret: "s".repeat(40),
      fetch: (async (_url: string, init: RequestInit) => {
        auth = new Headers(init.headers).get("authorization") ?? "";
        return Response.json({ conversationId: "c", reply: { text: "hi" } });
      }) as never,
    });
    expect(await post(update)).toEqual({ text: "hi" });
    expect(auth).toBe(`Bearer ${"s".repeat(40)}`);
  });

  test("a malformed engine reply is refused, not sent", async () => {
    const post = enginePoster({
      engineUrl: "http://engine.test",
      secret: "s",
      attempts: 1,
      fetch: (async () =>
        Response.json({
          conversationId: "c",
          reply: { text: "hi", buttons: [{ label: "x", data: "y".repeat(65) }] },
        })) as never,
    });
    await expect(post(update)).rejects.toThrow();
  });

  test("retries 5xx and network errors, but not 4xx", async () => {
    let calls = 0;
    const flaky = enginePoster({
      engineUrl: "http://engine.test",
      secret: "s",
      backoffMs: 1,
      fetch: (async () => {
        calls++;
        if (calls === 1) throw new TypeError("connection refused");
        if (calls === 2) return new Response("", { status: 503 });
        return Response.json({ conversationId: "c", reply: null });
      }) as never,
    });
    expect(await flaky(update)).toBeNull();
    expect(calls).toBe(3);

    let refused = 0;
    const bad = enginePoster({
      engineUrl: "http://engine.test",
      secret: "s",
      backoffMs: 1,
      fetch: (async () => (refused++, new Response("", { status: 401 }))) as never,
    });
    await expect(bad(update)).rejects.toThrow("401");
    expect(refused).toBe(1);
  });
});
