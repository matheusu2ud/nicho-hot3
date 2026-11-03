export type PlanId = "monthly_10" | "monthly_1499" | "lifetime";

export interface Plan {
  id: PlanId;
  title: string;
  amountCents: number;
  durationDays: number | null;
}

export const PLANS: Record<PlanId, Plan> = {
  monthly_10: {
    id: "monthly_10",
    title: "VIP 15 dias - R$ 8,90",
    amountCents: 890,
    durationDays: 15
  },
  monthly_1499: {
    id: "monthly_1499",
    title: "VIP mensal - R$ 14,90",
    amountCents: 1490,
    durationDays: 30
  },
  lifetime: {
    id: "lifetime",
    title: "VIP permanente - R$ 24,90",
    amountCents: 2490,
    durationDays: null
  }
};

export function isPlanId(value: string): value is PlanId {
  return Object.hasOwn(PLANS, value);
}

export function formatBRL(amountCents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(amountCents / 100);
}
