import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredChasePayApiKey(): string {
  const value =
    process.env.CHASEPAY_API_KEY?.trim() ||
    process.env.CHASEPAY_AUTHORIZATION?.trim();
  if (!value) {
    throw new Error("Missing required environment variable: CHASEPAY_API_KEY");
  }
  return value;
}

export interface Config {
  botMode: "preview" | "live";
  botToken: string;
  chasepayApiKey: string | null;
  chasepayWebhookSecret: string | null;
  vipChannelId: string | null;
  supportUsername: string;
  publicBaseUrl: string | null;
  port: number;
  databasePath: string;
}

export function loadConfig(): Config {
  const botMode = (process.env.BOT_MODE?.trim().toLowerCase() || "preview");
  if (botMode !== "preview" && botMode !== "live") {
    throw new Error("BOT_MODE must be either preview or live");
  }

  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const liveMode = botMode === "live";
  const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/+$/, "");
  const parsedBaseUrl = new URL(publicBaseUrl);
  if (parsedBaseUrl.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use HTTPS");
  }

  return {
    botMode,
    botToken: required("BOT_TOKEN"),
    chasepayApiKey: liveMode ? requiredChasePayApiKey() : null,
    chasepayWebhookSecret: liveMode ? required("CHASEPAY_WEBHOOK_SECRET") : null,
    vipChannelId: liveMode ? required("VIP_CHANNEL_ID") : null,
    supportUsername: (process.env.SUPPORT_USERNAME ?? "ceoc2b").replace(/^@/, ""),
    publicBaseUrl,
    port,
    databasePath: liveMode
      ? process.env.DATABASE_PATH ?? "./data/vip-bot.sqlite"
      : process.env.PREVIEW_DATABASE_PATH ?? "./data/vip-bot-preview.sqlite"
  };
}
