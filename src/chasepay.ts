import { createHmac, timingSafeEqual } from "node:crypto";
import type { Order } from "./database.js";

const API_BASE_URL = "https://api.chasepay.com.br";

interface ChaseChargeResponse {
  data?: {
    status?: string;
    pix_qr_code?: string | null;
    external_id?: string;
    amount_cents?: number;
  };
  error?: {
    message?: string;
  };
}

export class ChasePayError extends Error {
  constructor(
    message: string,
    readonly outcomeUnknown = false
  ) {
    super(message);
    this.name = "ChasePayError";
  }
}

function bearerAuthorization(apiKey: string): string {
  const value = apiKey.trim();
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

export async function createPixCharge(
  apiKey: string,
  order: Order
): Promise<{ status: string; pixCode: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/v1/charges`, {
      method: "POST",
      headers: {
        Authorization: bearerAuthorization(apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount_cents: order.amountCents,
        method: "pix",
        external_id: order.externalId,
        description: order.planId
      }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    throw new ChasePayError(`ChasePay request failed: ${message}`, true);
  }

  let body: ChaseChargeResponse;
  try {
    body = (await response.json()) as ChaseChargeResponse;
  } catch {
    throw new ChasePayError(
      `ChasePay returned a non-JSON response (HTTP ${response.status})`,
      response.status >= 500
    );
  }

  if (!response.ok) {
    const reason = body.error?.message ?? `HTTP ${response.status}`;
    throw new ChasePayError(`ChasePay rejected the charge: ${reason}`);
  }

  const data = body.data;
  if (!data || typeof data.status !== "string") {
    throw new ChasePayError("ChasePay response did not contain data.status", true);
  }

  if (
    data.external_id !== undefined &&
    data.external_id !== order.externalId
  ) {
    throw new ChasePayError("ChasePay returned a different external_id", true);
  }
  if (
    data.amount_cents !== undefined &&
    data.amount_cents !== order.amountCents
  ) {
    throw new ChasePayError("ChasePay returned a different amount_cents", true);
  }

  return {
    status: data.status,
    pixCode:
      typeof data.pix_qr_code === "string" && data.pix_qr_code.trim()
        ? data.pix_qr_code.trim()
        : null
  };
}

export function verifyChaseSignature(
  rawBody: Buffer,
  receivedSignature: string | undefined,
  secret: string
): boolean {
  if (!receivedSignature) {
    return false;
  }

  const normalized = receivedSignature.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(normalized, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface PaidChargeEvent {
  event: string;
  externalId?: string;
  amountCents?: number;
}

export function parseChargeEvent(rawBody: string): PaidChargeEvent {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new Error("Webhook body is not valid JSON");
  }

  if (!isRecord(value)) {
    throw new Error("Webhook body must be a JSON object");
  }

  const event = stringValue(value.event) ?? stringValue(value.type);
  if (!event) {
    throw new Error("Webhook is missing event type");
  }
  if (event === "webhook.test") {
    return { event };
  }

  const data = isRecord(value.data) ? value.data : value;
  const externalId =
    stringValue(data.external_id) ??
    (isRecord(data.charge) ? stringValue(data.charge.external_id) : undefined);
  const amountCents =
    numberValue(data.amount_cents) ??
    (isRecord(data.charge) ? numberValue(data.charge.amount_cents) : undefined);

  if (event === "charge.paid" && (!externalId || amountCents === undefined)) {
    throw new Error("Webhook is missing event, external_id, or amount_cents");
  }

  return { event, externalId, amountCents };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
