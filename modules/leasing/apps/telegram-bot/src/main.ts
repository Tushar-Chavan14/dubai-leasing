import { loadEnv } from "@leasing/core";
import { run, sequentialize } from "@grammyjs/runner";
import { Bot, GrammyError, webhookCallback } from "grammy";
import { COMMANDS, enginePoster, installRelay } from "./relay.ts";

/**
 * Telegram enquiry bot (grammY, decision D24). Telegram receives enquiries only; everything
 * outbound to applicants and tenants goes by email (AGENTS.md rule 10). The engine owns every
 * conversation; this process only relays updates and replies.
 */
const env = loadEnv();
if (!env.TELEGRAM_BOT_TOKEN) {
  console.log("telegram-bot: TELEGRAM_BOT_TOKEN not set; bot disabled");
  process.exit(0);
}
if (!env.CHANNEL_SECRET) throw new Error("CHANNEL_SECRET is required for the Telegram bot (same value as the engine)");
if (env.TELEGRAM_MODE === "webhook" && (!env.TELEGRAM_WEBHOOK_URL || !env.TELEGRAM_WEBHOOK_SECRET)) {
  throw new Error("TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET are required in webhook mode");
}

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
bot.catch((err) =>
  console.error(
    `telegram-bot: update ${err.ctx.update.update_id} failed: ${err.error instanceof Error ? err.error.message : "error"}`,
  ),
);
// Different customers run in parallel; one customer's updates run in order.
bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));
installRelay(bot, enginePoster({ engineUrl: env.ENGINE_URL, secret: env.CHANNEL_SECRET }));

await bot.api.setMyCommands(COMMANDS.en, { scope: { type: "all_private_chats" } });
await bot.api.setMyCommands(COMMANDS.ar, { scope: { type: "all_private_chats" }, language_code: "ar" });

if (env.TELEGRAM_MODE === "webhook") {
  const handle = webhookCallback(bot, "std/http", "return", 55_000, env.TELEGRAM_WEBHOOK_SECRET);
  await bot.api.setWebhook(env.TELEGRAM_WEBHOOK_URL!, {
    secret_token: env.TELEGRAM_WEBHOOK_SECRET!,
    allowed_updates: ["message", "callback_query", "my_chat_member"],
  });
  const server = Bun.serve({
    port: env.TELEGRAM_WEBHOOK_PORT,
    idleTimeout: 60,
    fetch: (req) =>
      new URL(req.url).pathname === "/telegram/webhook" && req.method === "POST"
        ? handle(req)
        : new Response("not found", { status: 404 }),
  });
  console.log(`telegram-bot: webhook on :${server.port}/telegram/webhook → engine ${env.ENGINE_URL}`);
} else {
  await bot.api.deleteWebhook();
  const runner = run(bot, { runner: { fetch: { allowed_updates: ["message", "callback_query", "my_chat_member"] } } });
  console.log(`telegram-bot: polling → engine ${env.ENGINE_URL}`);
  // Telegram allows one long-polling connection per bot token. A second copy gets 409 Conflict.
  void runner.task()?.catch((e: unknown) => {
    const conflict = e instanceof GrammyError && e.error_code === 409;
    console.error(
      conflict
        ? "telegram-bot: another copy of this bot is already polling Telegram (409 Conflict). Stop the other one (a second `bun run dev`, or an old process: `pgrep -af telegram-bot`) and start again."
        : `telegram-bot: polling stopped: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(1);
  });
  const stop = () => {
    if (runner.isRunning()) void runner.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
