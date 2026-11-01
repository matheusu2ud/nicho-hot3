import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const environmentKeys = [
  "BOT_MODE",
  "BOT_TOKEN",
  "CHASEPAY_API_KEY",
  "CHASEPAY_AUTHORIZATION",
  "CHASEPAY_WEBHOOK_SECRET",
  "VIP_CHANNEL_ID",
  "PUBLIC_BASE_URL",
  "DATABASE_PATH",
  "PREVIEW_DATABASE_PATH"
];

function withCleanEnvironment(run: () => void): void {
  const previous = new Map(
    environmentKeys.map((key) => [key, process.env[key]])
  );
  for (const key of environmentKeys) delete process.env[key];
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("preview mode needs only a Telegram bot token and uses a separate database", () => {
  withCleanEnvironment(() => {
    process.env.BOT_MODE = "preview";
    process.env.BOT_TOKEN = "test-telegram-token";

    const config = loadConfig();

    assert.equal(config.botMode, "preview");
    assert.equal(config.chasepayApiKey, null);
    assert.equal(config.chasepayWebhookSecret, null);
    assert.equal(config.vipChannelId, null);
    assert.equal(config.publicBaseUrl, null);
    assert.equal(config.databasePath, "./data/vip-bot-preview.sqlite");
  });
});

test("live mode refuses to start without the private ChasePay API key", () => {
  withCleanEnvironment(() => {
    process.env.BOT_MODE = "live";
    process.env.BOT_TOKEN = "test-telegram-token";
    process.env.PUBLIC_BASE_URL = "https://example.com";
    process.env.CHASEPAY_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.VIP_CHANNEL_ID = "-1001234567890";

    assert.throws(loadConfig, /CHASEPAY_API_KEY/);
  });
});