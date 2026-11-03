import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createPixCharge,
  parseChargeEvent,
  verifyChaseSignature
} from "../src/chasepay.js";
import type { Order } from "../src/database.js";

const order: Order = {
  externalId: "order-test-001",
  telegramUserId: 12345,
  planId: "monthly_10",
  amountCents: 890,
  status: "creating",
  createdAt: 1_000,
  pixCode: null,
  notificationSent: false,
  paidAt: null
};

test("sends a Pix charge request and trims the returned copy-and-paste code", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      data: {
        status: "pending",
        pix_qr_code: "  000201-test-pix-code \n",
        external_id: order.externalId,
        amount_cents: order.amountCents
      }
    }), { status: 201, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await createPixCharge("test-token", order);

  assert.equal(requestUrl, "https://api.chasepay.com.br/v1/charges");
  assert.equal(requestInit?.method, "POST");
  assert.equal(
    (requestInit?.headers as Record<string, string>).Authorization,
    "Bearer test-token"
  );
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    amount_cents: 890,
    method: "pix",
    external_id: "order-test-001",
    description: "monthly_10"
  });
  assert.deepEqual(result, {
    status: "pending",
    pixCode: "000201-test-pix-code"
  });
});

test("treats a blank Pix payload as missing", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { status: "pending", pix_qr_code: "  \n " }
  }), { status: 200, headers: { "content-type": "application/json" } });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await createPixCharge("test-token", order);
  assert.equal(result.pixCode, null);
});

test("does not add a second Bearer prefix", async (t) => {
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = async (_input, init) => {
    authorization = (init?.headers as Record<string, string>).Authorization;
    return new Response(JSON.stringify({
      data: { status: "pending", pix_qr_code: "valid-code" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await createPixCharge("Bearer existing-token", order);
  assert.equal(authorization, "Bearer existing-token");
});

test("validates webhook signatures and rejects altered bodies", () => {
  const secret = "test-webhook-secret";
  const body = Buffer.from('{"event":"charge.paid"}');
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(verifyChaseSignature(body, `sha256=${signature}`, secret), true);
  assert.equal(verifyChaseSignature(Buffer.from(`${body} `), signature, secret), false);
  assert.equal(verifyChaseSignature(body, "not-a-signature", secret), false);
});

test("parses paid events and rejects events without required payment data", () => {
  assert.deepEqual(
    parseChargeEvent(JSON.stringify({
      event: "charge.paid",
      data: { external_id: "order-test-001", amount_cents: 890 }
    })),
    { event: "charge.paid", externalId: "order-test-001", amountCents: 890 }
  );
  assert.throws(
    () => parseChargeEvent(JSON.stringify({ event: "charge.paid", data: {} })),
    /missing event, external_id, or amount_cents/
  );
});