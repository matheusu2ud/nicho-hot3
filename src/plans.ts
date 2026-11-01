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
    title: "VIP mensal - R$ 10,00",
    amountCents: 1000,
    durationDays: 30
  },
  monthly_1499: {
    id: "monthly_1499",
    title: "VIP mensal - R$ 14,99",
    amountCents: 1499,
    durationDays: 30
  },
  lifetime: {
    id: "lifetime",
    title: "VIP permanente - R$ 19,99",
    amountCents: 1999,
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
