import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { PlanId } from "./plans.js";

export interface Order {
  externalId: string;
  telegramUserId: number;
  planId: PlanId;
  amountCents: number;
  status: "creating" | "pending" | "paid" | "failed" | "unknown" | "refunded";
  createdAt: number;
  pixCode: string | null;
  notificationSent: boolean;
  paidAt: number | null;
}

export interface Entitlement {
  telegramUserId: number;
  expiresAt: number | null;
  permanent: boolean;
}

export class VipDatabase {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    const absolutePath = resolve(filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new Database(absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS age_verifications (
        telegram_user_id INTEGER PRIMARY KEY,
        verified_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orders (
        external_id TEXT PRIMARY KEY,
        telegram_user_id INTEGER NOT NULL,
        plan_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        pix_code TEXT,
        notification_sent INTEGER NOT NULL DEFAULT 0,
        paid_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS entitlements (
        telegram_user_id INTEGER PRIMARY KEY,
        expires_at INTEGER,
        permanent INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  isAgeVerified(userId: number): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM age_verifications WHERE telegram_user_id = ?")
        .get(userId)
    );
  }

  verifyAge(userId: number, now = Date.now()): void {
    this.db
      .prepare(
        "INSERT INTO age_verifications (telegram_user_id, verified_at) VALUES (?, ?) ON CONFLICT(telegram_user_id) DO NOTHING"
      )
      .run(userId, now);
  }

  createOrder(order: Order): void {
    this.db
      .prepare(
        `INSERT INTO orders
          (external_id, telegram_user_id, plan_id, amount_cents, status, created_at, pix_code, notification_sent, paid_at)
         VALUES
          (@externalId, @telegramUserId, @planId, @amountCents, @status, @createdAt, @pixCode, @notificationSent, @paidAt)`
      )
      .run({
        ...order,
        notificationSent: order.notificationSent ? 1 : 0
      });
  }

  setOrderPayment(externalId: string, pixCode: string): void {
    this.db
      .prepare("UPDATE orders SET status = 'pending', pix_code = ? WHERE external_id = ?")
      .run(pixCode, externalId);
  }

  setOrderStatus(externalId: string, status: Order["status"]): void {
    this.db
      .prepare("UPDATE orders SET status = ? WHERE external_id = ?")
      .run(status, externalId);
  }

  getOrder(externalId: string): Order | undefined {
    const row = this.db
      .prepare(
        `SELECT external_id AS externalId, telegram_user_id AS telegramUserId,
                plan_id AS planId, amount_cents AS amountCents, status, created_at AS createdAt,
                pix_code AS pixCode, notification_sent AS notificationSent, paid_at AS paidAt
         FROM orders WHERE external_id = ?`
      )
      .get(externalId) as (Omit<Order, "notificationSent"> & {
      notificationSent: number;
    }) | undefined;
    return row
      ? { ...row, notificationSent: row.notificationSent === 1 }
      : undefined;
  }

  getRecentPendingOrder(
    userId: number,
    planId: PlanId
  ): Order | undefined {
    const row = this.db
      .prepare(
        `SELECT external_id AS externalId, telegram_user_id AS telegramUserId,
                plan_id AS planId, amount_cents AS amountCents, status, created_at AS createdAt,
                pix_code AS pixCode, notification_sent AS notificationSent, paid_at AS paidAt
         FROM orders
         WHERE telegram_user_id = ? AND plan_id = ?
           AND status IN ('creating', 'pending', 'unknown')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId, planId) as (Omit<Order, "notificationSent"> & {
      notificationSent: number;
    }) | undefined;
    return row
      ? { ...row, notificationSent: row.notificationSent === 1 }
      : undefined;
  }

  getOrderHistory(userId: number, limit = 10): Order[] {
    const rows = this.db
      .prepare(
        `SELECT external_id AS externalId, telegram_user_id AS telegramUserId,
                plan_id AS planId, amount_cents AS amountCents, status, created_at AS createdAt,
                pix_code AS pixCode, notification_sent AS notificationSent, paid_at AS paidAt
         FROM orders
         WHERE telegram_user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, limit) as Array<Omit<Order, "notificationSent"> & {
      notificationSent: number;
    }>;
    return rows.map((row) => ({
      ...row,
      notificationSent: row.notificationSent === 1
    }));
  }

  markOrderNotificationSent(externalId: string): void {
    this.db
      .prepare("UPDATE orders SET notification_sent = 1 WHERE external_id = ?")
      .run(externalId);
  }

  confirmPaymentWithoutGrantingAccess(
    externalId: string,
    amountCents: number,
    now = Date.now()
  ): Order | undefined {
    const order = this.getOrder(externalId);
    if (!order || order.amountCents !== amountCents) return undefined;
    if (order.status === "paid") return order;
    if (!["creating", "pending", "unknown"].includes(order.status)) {
      return undefined;
    }

    this.db
      .prepare(
        "UPDATE orders SET status = 'paid', paid_at = ? WHERE external_id = ?"
      )
      .run(now, externalId);
    return { ...order, status: "paid", paidAt: now };
  }

  revokeOrder(externalId: string): void {
    const transaction = this.db.transaction(() => {
      const order = this.getOrder(externalId);
      if (!order || order.status !== "paid") return;
      this.db
        .prepare("UPDATE orders SET status = 'refunded' WHERE external_id = ?")
        .run(externalId);
      this.rebuildEntitlementInTransaction(order.telegramUserId);
    });
    transaction();
  }

  getEntitlement(userId: number): Entitlement | undefined {
    const row = this.db
      .prepare(
        `SELECT telegram_user_id AS telegramUserId, expires_at AS expiresAt, permanent
         FROM entitlements WHERE telegram_user_id = ?`
      )
      .get(userId) as
      | { telegramUserId: number; expiresAt: number | null; permanent: number }
      | undefined;
    return row
      ? {
          telegramUserId: row.telegramUserId,
          expiresAt: row.expiresAt,
          permanent: row.permanent === 1
        }
      : undefined;
  }

  grantEntitlement(userId: number, planId: PlanId, now = Date.now()): Entitlement {
    const grant = this.db.transaction(() => {
      return this.grantEntitlementInTransaction(userId, planId, now);
    });
    return grant();
  }

  private grantEntitlementInTransaction(
    userId: number,
    planId: PlanId,
    now: number
  ): Entitlement {
    const current = this.getEntitlement(userId);
    if (current?.permanent) {
      return current;
    }

    const durationDays = planId === "lifetime" ? null : 30;
    const expiresAt =
      durationDays === null
        ? null
        : Math.max(current?.expiresAt ?? now, now) +
          durationDays * 24 * 60 * 60 * 1000;
    const permanent = durationDays === null;

    this.db
      .prepare(
        `INSERT INTO entitlements (telegram_user_id, expires_at, permanent, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           expires_at = excluded.expires_at,
           permanent = excluded.permanent,
           updated_at = excluded.updated_at`
      )
      .run(userId, expiresAt, permanent ? 1 : 0, now);

    return { telegramUserId: userId, expiresAt, permanent };
  }

  private rebuildEntitlementInTransaction(userId: number): void {
    const paidOrders = this.db
      .prepare(
        `SELECT plan_id AS planId, paid_at AS paidAt FROM orders
         WHERE telegram_user_id = ? AND status = 'paid' AND paid_at IS NOT NULL
         ORDER BY paid_at, created_at`
      )
      .all(userId) as Array<{ planId: PlanId; paidAt: number }>;

    if (paidOrders.some((order) => order.planId === "lifetime")) {
      this.db
        .prepare(
          `INSERT INTO entitlements (telegram_user_id, expires_at, permanent, updated_at)
           VALUES (?, NULL, 1, ?)
           ON CONFLICT(telegram_user_id) DO UPDATE SET
             expires_at = NULL, permanent = 1, updated_at = excluded.updated_at`
        )
        .run(userId, Date.now());
      return;
    }

    let expiresAt: number | null = null;
    for (const order of paidOrders) {
      const start = Math.max(expiresAt ?? order.paidAt, order.paidAt);
      expiresAt = start + 30 * 24 * 60 * 60 * 1000;
    }

    if (expiresAt === null || expiresAt <= Date.now()) {
      this.db
        .prepare("DELETE FROM entitlements WHERE telegram_user_id = ?")
        .run(userId);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO entitlements (telegram_user_id, expires_at, permanent, updated_at)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           expires_at = excluded.expires_at,
           permanent = 0, updated_at = excluded.updated_at`
      )
      .run(userId, expiresAt, Date.now());
  }

  getExpiredEntitlements(now = Date.now()): number[] {
    const rows = this.db
      .prepare(
        "SELECT telegram_user_id AS userId FROM entitlements WHERE permanent = 0 AND expires_at <= ?"
      )
      .all(now) as Array<{ userId: number }>;
    return rows.map((row) => row.userId);
  }

  removeEntitlement(userId: number): void {
    this.db
      .prepare(
        "DELETE FROM entitlements WHERE telegram_user_id = ? AND permanent = 0"
      )
      .run(userId);
  }

  close(): void {
    this.db.close();
  }
}
