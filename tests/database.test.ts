import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { VipDatabase } from "../src/database.js";

function withDatabase(run: (db: VipDatabase) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "vip-bot-test-"));
  const db = new VipDatabase(path.join(directory, "test.sqlite"));
  try {
    run(db);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function makeOrder() {
  return {
    externalId: "order-test-001",
    telegramUserId: 12345,
    planId: "monthly_10" as const,
    amountCents: 1000,
    status: "creating" as const,
    createdAt: 1_000,
    pixCode: null,
    notificationSent: false,
    paidAt: null
  };
}

test("creates and reads an order with a pending Pix charge", () => {
  withDatabase((db) => {
    db.createOrder(makeOrder());
    db.setOrderPayment("order-test-001", "000201pix-copy-and-paste");

    assert.deepEqual(db.getOrder("order-test-001"), {
      ...makeOrder(),
      status: "pending",
      pixCode: "000201pix-copy-and-paste"
    });
    assert.equal(
      db.getRecentPendingOrder(12345, "monthly_10")?.externalId,
      "order-test-001"
    );
  });
});

test("only grants access once a matching payment is confirmed", () => {
  withDatabase((db) => {
    db.createOrder(makeOrder());

    assert.equal(db.completePaidOrder("order-test-001", 999), undefined);
    const completion = db.completePaidOrder("order-test-001", 1000, 10_000);
    assert.equal(completion?.newlyPaid, true);
    assert.deepEqual(db.getEntitlement(12345), {
      telegramUserId: 12345,
      expiresAt: 10_000 + 30 * 24 * 60 * 60 * 1000,
      permanent: false
    });

    assert.equal(
      db.completePaidOrder("order-test-001", 1000, 20_000)?.newlyPaid,
      false
    );
    assert.equal(
      db.getEntitlement(12345)?.expiresAt,
      10_000 + 30 * 24 * 60 * 60 * 1000
    );
  });
});