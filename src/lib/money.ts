export type DepositState = "NOT_REQUIRED" | "PENDING" | "PARTIAL" | "PAID";
export type PaymentState = "NO_PRICE" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";

export const MAX_MONEY_CENTS = 9_999_999_999;

export type MoneySummary = {
  totalReceivedCents: number;
  depositPendingCents: number;
  remainingTotalCents: number | null;
  depositState: DepositState;
  paymentState: PaymentState;
};

export function parseMoneyInput(value: string, { optional = false }: { optional?: boolean } = {}) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized && optional) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;

  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_MONEY_CENTS) return undefined;
  return cents;
}

export function decimalToCents(value: { toString(): string } | string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = parseMoneyInput(String(value), { optional: false });
  if (parsed === undefined || parsed === null) {
    throw new Error(`Invalid stored money value: ${String(value)}`);
  }
  return parsed;
}

export function centsToDecimal(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Money cents must be a non-negative safe integer.");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function formatEuro(cents: number | null, locale: "en" | "es") {
  if (cents === null) return "—";
  return new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-GB", {
    style: "currency",
    currency: "EUR",
  }).format(Number(centsToDecimal(cents)));
}

export function calculateMoneySummary({
  agreedPriceCents,
  depositRequiredCents,
  paymentsCents,
}: {
  agreedPriceCents: number | null;
  depositRequiredCents: number;
  paymentsCents: number[];
}): MoneySummary {
  if (!Number.isSafeInteger(depositRequiredCents) || depositRequiredCents < 0) {
    throw new Error("Deposit must be a non-negative safe integer.");
  }
  if (
    agreedPriceCents !== null &&
    (!Number.isSafeInteger(agreedPriceCents) || agreedPriceCents < 0)
  ) {
    throw new Error("Agreed price must be null or a non-negative safe integer.");
  }
  if (paymentsCents.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) {
    throw new Error("Payments must be non-negative safe integers.");
  }

  const totalReceivedCents = paymentsCents.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(totalReceivedCents)) {
    throw new Error("Payment total exceeds safe integer range.");
  }

  const depositPendingCents = Math.max(depositRequiredCents - totalReceivedCents, 0);
  const remainingTotalCents =
    agreedPriceCents === null ? null : Math.max(agreedPriceCents - totalReceivedCents, 0);

  const depositState: DepositState =
    depositRequiredCents === 0
      ? "NOT_REQUIRED"
      : totalReceivedCents === 0
        ? "PENDING"
        : totalReceivedCents < depositRequiredCents
          ? "PARTIAL"
          : "PAID";

  const paymentState: PaymentState =
    agreedPriceCents === null
      ? "NO_PRICE"
      : totalReceivedCents === agreedPriceCents
        ? "PAID"
        : totalReceivedCents === 0
          ? "UNPAID"
          : totalReceivedCents < agreedPriceCents
            ? "PARTIAL"
            : "OVERPAID";

  return {
    totalReceivedCents,
    depositPendingCents,
    remainingTotalCents,
    depositState,
    paymentState,
  };
}
