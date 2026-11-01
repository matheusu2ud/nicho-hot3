import { loadConfig } from "./config.js";
import { VipDatabase } from "./database.js";
import { createBot, expireMemberships } from "./bot.js";
import { createWebhookServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new VipDatabase(config.databasePath);
  const bot = createBot(config, db);
  const server =
    config.botMode === "live"
      ? createWebhookServer(config, db, bot)
      : null;

  await bot.launch();
  console.log(
    config.botMode === "preview"
      ? "Telegram bot started in PREVIEW mode; payments are disabled."
      : "Telegram bot started in LIVE mode."
  );

  const expirationTimer =
    config.botMode === "live"
      ? setInterval(() => {
          void expireMemberships(bot, config, db);
        }, 60_000)
      : null;
  expirationTimer?.unref();
  if (config.botMode === "live") {
    void expireMemberships(bot, config, db);
  }

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}; shutting down`);
    if (expirationTimer) clearInterval(expirationTimer);
    bot.stop(signal);
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    db.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Bot startup failed:", error);
  process.exitCode = 1;
});
