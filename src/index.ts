import { loadConfig } from "./config.js";
import { VipDatabase } from "./database.js";
import { createBot } from "./bot.js";
import { createWebhookServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new VipDatabase(config.databasePath);
  const bot = createBot(config, db);
  const server = await createWebhookServer(config, db, bot);
  console.log(
    config.botMode === "preview"
      ? "Telegram bot started in PREVIEW mode with webhooks; payments are disabled."
      : "Telegram bot started in LIVE mode; payments require manual access delivery."
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}; shutting down`);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    db.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("Bot startup failed:", error);
  process.exitCode = 1;
});
