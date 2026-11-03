import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { processChasePayWebhook } from "../src/bot.js";
import { VipDatabase } from "../src/database.js";

test("notifies on confirmed payment without granting access or duplicating the message", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "vip-bot-webhook-test-"));
  const db = new VipDatabase(path.join(directory, "test.sqlite"));
  const order = {
    externalId: "webhook-order-001",
    telegramUserId: 12345,
    planId: "monthly_10" as const,
    amountCents: 890,
    status: "pending" as const,
    createdAt: 1_000,
    pixCode: "pix-code",
    notificationSent: false,
    paidAt: null
  };
  const body = JSON.stringify({
    event: "charge.paid",
    data: { external_id: order.externalId, amount_cents: order.amountCents }
  });
  const messages: Array<{ userId: number; text: string }> = [];
  const sendMessage = async (userId: number, text: string): Promise<void> => {
    messages.push({ userId, text });
  };

  try {
    db.createOrder(order);
    db.recordWebhook("confirmed-event", body);

    await processChasePayWebhook(db, "confirmed-event", body, sendMessage);

    assert.equal(db.getOrder(order.externalId)?.status, "paid");
    assert.equal(db.getEntitlement(order.telegramUserId), undefined);
    assert.equal(db.getPendingWebhooks().length, 0);
    assert.deepEqual(messages, [{
      userId: order.telegramUserId,
      text: "✅ Pagamento confirmado. Sua compra foi registrada. A liberação do acesso é feita manualmente."
    }]);

    const duplicateBodyHash = "duplicate-confirmation";
    db.recordWebhook(duplicateBodyHash, body);
    await processChasePayWebhook(db, duplicateBodyHash, body, sendMessage);

    assert.equal(messages.length, 1);
    assert.equal(db.getPendingWebhooks().length, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
