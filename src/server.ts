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
const MAX_BODY_BYTES = 64 * 1024;

export function createWebhookServer(
  config: Config,
  db: VipDatabase,
  bot: Telegraf
): Server {
  const webhookSecret = config.chasepayWebhookSecret;
  if (!webhookSecret) {
    throw new Error("CHASEPAY_WEBHOOK_SECRET is required in live mode");
  }

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
    void handleRequest(request, response, config, db, webhookSecret, drainQueue);
  });
  server.on("error", (error) => {
    console.error("Webhook server error:", error);
  });
  server.listen(config.port, () => {
    console.log(`Webhook server listening on port ${config.port}`);
    void drainQueue();
  });
  const interval = setInterval(() => void drainQueue(), 5_000);
  interval.unref();
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: Config,
  db: VipDatabase,
  webhookSecret: string,
  drainQueue: () => Promise<void>
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
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
