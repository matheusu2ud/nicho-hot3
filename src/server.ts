import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { VipDatabase } from "./database.js";
import {
  parseChargeEvent,
  verifyChaseSignature
} from "./chasepay.js";
import { processWebhookBody } from "./bot.js";
import type { Telegraf } from "telegraf";

const WEBHOOK_PATH = "/webhooks/chasepay";
const TELEGRAM_WEBHOOK_PATH = "/webhooks/telegram";
const MAX_BODY_BYTES = 64 * 1024;

export async function createWebhookServer(
  config: Config,
  db: VipDatabase,
  bot: Telegraf
): Promise<Server> {
  const webhookSecret = config.chasepayWebhookSecret;
  const telegramWebhookSecret = createHash("sha256")
    .update(`telegram-webhook:${config.botToken}`)
    .digest("hex");
  const telegramWebhook = bot.webhookCallback(TELEGRAM_WEBHOOK_PATH, {
    secretToken: telegramWebhookSecret
  });

  let draining = false;

  const drainQueue = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      for (const job of db.getPendingWebhooks()) {
        try {
          await processWebhookBody(bot, config, db, job.bodyHash, job.body);
        } catch (error) {
          console.error("Could not process ChasePay webhook:", error);
          break;
        }
      }
    } finally {
      draining = false;
    }
  };

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
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
    void handleRequest(request, response, config, db, webhookSecret, drainQueue);
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

  if (webhookSecret) {
    void drainQueue();
    const interval = setInterval(() => void drainQueue(), 5_000);
    interval.unref();
  }
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: Config,
  db: VipDatabase,
  webhookSecret: string | null,
  drainQueue: () => Promise<void>
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (!webhookSecret) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  if (request.method !== "POST" || path !== WEBHOOK_PATH) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readBody(request);
  } catch (error) {
    const status = error instanceof Error && error.message === "body too large" ? 413 : 400;
    response.writeHead(status);
    response.end(status === 413 ? "Payload too large" : "Invalid body");
    return;
  }

  if (
    !verifyChaseSignature(
      rawBody,
      getHeader(request, "x-chase-signature"),
      webhookSecret
    )
  ) {
    response.writeHead(401);
    response.end("Invalid webhook signature");
    return;
  }

  const body = rawBody.toString("utf8");
  try {
    parseChargeEvent(body);
  } catch (error) {
    console.error("Rejected signed ChasePay webhook:", error);
    response.writeHead(400);
    response.end("Invalid webhook payload");
    return;
  }

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  db.recordWebhook(bodyHash, body);
  response.writeHead(200);
  response.end("OK");
  setImmediate(() => void drainQueue());
}

function getHeader(
  request: IncomingMessage,
  name: string
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new Error("body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
