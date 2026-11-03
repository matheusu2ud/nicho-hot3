import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { VipDatabase } from "../src/database.js";
import { PLANS } from "../src/plans.js";

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
    amountCents: 890,
    status: "creating" as const,
    createdAt: 1_000,
    pixCode: null,
    notificationSent: false,
    paidAt: null
  };
}

test("uses the requested Pix prices for every plan", () => {
  assert.deepEqual(
    Object.values(PLANS).map((plan) => plan.amountCents),
    [890, 1490, 2490]
  );
});

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

test("confirms payment without granting access automatically", () => {
  withDatabase((db) => {
    db.createOrder(makeOrder());

    assert.equal(
      db.confirmPaymentWithoutGrantingAccess("order-test-001", 889),
      undefined
    );
    const confirmed = db.confirmPaymentWithoutGrantingAccess(
      "order-test-001",
      890,
      10_000
    );

    assert.equal(confirmed?.status, "paid");
    assert.equal(confirmed?.paidAt, 10_000);
    assert.equal(db.getEntitlement(12345), undefined);
    assert.equal(
      db.confirmPaymentWithoutGrantingAccess("order-test-001", 890)?.paidAt,
      10_000
    );
  });
});

test("lists a user's real Pix order history newest first and excludes other users", () => {
  withDatabase((db) => {
    db.createOrder(makeOrder());
    db.createOrder({
      ...makeOrder(),
      externalId: "order-test-002",
      planId: "lifetime",
      amountCents: 2490,
      createdAt: 2_000
    });
    db.createOrder({
      ...makeOrder(),
      externalId: "other-user-order",
      telegramUserId: 67890,
      createdAt: 3_000
    });

    const history = db.getOrderHistory(12345);

    assert.deepEqual(
      history.map(({ externalId }) => externalId),
      ["order-test-002", "order-test-001"]
    );
    assert.equal(db.getOrderHistory(12345, 1).length, 1);
  });
});
