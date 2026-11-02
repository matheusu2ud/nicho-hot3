import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Config } from "./config.js";
import type { Telegraf } from "telegraf";

const TELEGRAM_WEBHOOK_PATH = "/webhooks/telegram";

export async function createWebhookServer(
  config: Config,
  bot: Telegraf
): Promise<Server> {
  const telegramWebhookSecret = createHash("sha256")
    .update(`telegram-webhook:${config.botToken}`)
    .digest("hex");
  const telegramWebhook = bot.webhookCallback(TELEGRAM_WEBHOOK_PATH, {
    secretToken: telegramWebhookSecret
  });

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && path === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (request.method === "POST" && path === TELEGRAM_WEBHOOK_PATH) {
      void telegramWebhook(request, response).catch((error: unknown) => {
        console.error("Could not process Telegram update:", error);
        if (!response.headersSent) {
          response.writeHead(500);
          response.end("Internal server error");
        }
      });
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  });

  server.on("error", (error) => {
    console.error("HTTP server error:", error);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`HTTP server listening on port ${config.port}`);

  try {
    if (!config.publicBaseUrl) {
      throw new Error("PUBLIC_BASE_URL is required to receive Telegram updates");
    }
    await bot.telegram.setWebhook(
      `${config.publicBaseUrl}${TELEGRAM_WEBHOOK_PATH}`,
      { secret_token: telegramWebhookSecret }
    );
    console.log("Telegram webhook configured.");
  } catch (error) {
    await new Promise<void>((resolve, reject) => {
      server.close((closeError) => (closeError ? reject(closeError) : resolve()));
    });
    throw error;
  }

  return server;
}
