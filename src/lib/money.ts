export type PaymentState =
  | "NO_DEPOSIT_REQUIRED"
  | "DEPOSIT_PENDING"
  | "PARTIALLY_PAID"
  | "DEPOSIT_PAID"
  | "FULLY_PAID";

export function parseMoneyToCents(value: unknown, allowBlank = false): number | null {
  if (value === null || value === undefined || value === "") {
    return allowBlank ? null : 0;
  }

  const normalized = String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("money_invalid");
  }

  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 999_999_999) {
    throw new Error("money_invalid");
  }

  return cents;
}

export function centsToDecimalString(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("money_invalid");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function decimalLikeToCents(value: { toString(): string } | string | number | null) {
  if (value === null) return null;
  return parseMoneyToCents(value.toString(), false) ?? 0;
}

export function calculateMoney({
  agreedTotalCents,
  depositRequiredCents,
  receivedCents,
}: {
  agreedTotalCents: number | null;
  depositRequiredCents: number;
  receivedCents: number;
}) {
  const depositRemainingCents = Math.max(depositRequiredCents - receivedCents, 0);
  const finalRemainingCents =
    agreedTotalCents === null ? null : Math.max(agreedTotalCents - receivedCents, 0);

  let state: PaymentState;
  if (agreedTotalCents !== null && receivedCents >= agreedTotalCents) {
    state = "FULLY_PAID";
  } else if (depositRequiredCents === 0) {
    state = receivedCents > 0 ? "PARTIALLY_PAID" : "NO_DEPOSIT_REQUIRED";
  } else if (receivedCents === 0) {
    state = "DEPOSIT_PENDING";
  } else if (receivedCents < depositRequiredCents) {
    state = "PARTIALLY_PAID";
  } else {
    state = "DEPOSIT_PAID";
  }

  return {
    depositRemainingCents,
    finalRemainingCents,
    state,
  };
}

export function validateDepositAgainstTotal(
  agreedTotalCents: number | null,
  depositRequiredCents: number,
) {
  if (agreedTotalCents !== null && depositRequiredCents > agreedTotalCents) {
    throw new Error("deposit_exceeds_total");
  }
}
