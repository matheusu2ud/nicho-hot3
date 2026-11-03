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
