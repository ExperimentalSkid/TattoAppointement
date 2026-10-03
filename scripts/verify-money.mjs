import assert from "node:assert/strict";
import {
  calculateMoneySummary,
  centsToDecimal,
  formatEuro,
  MAX_MONEY_CENTS,
  parseMoneyInput,
} from "../src/lib/money.ts";

assert.equal(parseMoneyInput("100"), 10000);
assert.equal(parseMoneyInput("100.5"), 10050);
assert.equal(parseMoneyInput("100,50"), 10050);
assert.equal(parseMoneyInput("0.01"), 1);
assert.equal(parseMoneyInput("", { optional: true }), null);
assert.equal(parseMoneyInput("12.345"), undefined);
assert.equal(parseMoneyInput("-1"), undefined);
assert.equal(parseMoneyInput("99999999.99"), MAX_MONEY_CENTS);
assert.equal(parseMoneyInput("100000000.00"), undefined);
assert.equal(centsToDecimal(10050), "100.50");
assert.equal(formatEuro(35050, "es").replace(/\s/g, " "), "350,50 €");
assert.equal(formatEuro(35050, "en"), "€350.50");
assert.equal(formatEuro(null, "es"), "—");
assert.equal(
  calculateMoneySummary({ agreedPriceCents: 0, depositRequiredCents: 0, paymentsCents: [] }).paymentState,
  "PAID",
  "an appointment with a zero agreed price has no unpaid balance",
);
assert.equal(
  calculateMoneySummary({ agreedPriceCents: 0, depositRequiredCents: 0, paymentsCents: [1] }).paymentState,
  "OVERPAID",
);

assert.deepEqual(
  calculateMoneySummary({
    agreedPriceCents: 30000,
    depositRequiredCents: 10000,
    paymentsCents: [],
  }),
  {
    totalReceivedCents: 0,
    depositPendingCents: 10000,
    remainingTotalCents: 30000,
    depositState: "PENDING",
    paymentState: "UNPAID",
  },
);

assert.deepEqual(
  calculateMoneySummary({
    agreedPriceCents: 30000,
    depositRequiredCents: 10000,
    paymentsCents: [4000],
  }),
  {
    totalReceivedCents: 4000,
    depositPendingCents: 6000,
    remainingTotalCents: 26000,
    depositState: "PARTIAL",
    paymentState: "PARTIAL",
  },
);

assert.deepEqual(
  calculateMoneySummary({
    agreedPriceCents: 30000,
    depositRequiredCents: 10000,
    paymentsCents: [4000, 6000],
  }),
  {
    totalReceivedCents: 10000,
    depositPendingCents: 0,
    remainingTotalCents: 20000,
    depositState: "PAID",
    paymentState: "PARTIAL",
  },
);

assert.deepEqual(
  calculateMoneySummary({
    agreedPriceCents: 30000,
    depositRequiredCents: 0,
    paymentsCents: [30000],
  }),
  {
    totalReceivedCents: 30000,
    depositPendingCents: 0,
    remainingTotalCents: 0,
    depositState: "NOT_REQUIRED",
    paymentState: "PAID",
  },
);

assert.deepEqual(
  calculateMoneySummary({
    agreedPriceCents: 30000,
    depositRequiredCents: 10000,
    paymentsCents: [32000],
  }),
  {
    totalReceivedCents: 32000,
    depositPendingCents: 0,
    remainingTotalCents: 0,
    depositState: "PAID",
    paymentState: "OVERPAID",
  },
);

assert.deepEqual(
  calculateMoneySummary({
    agreedPriceCents: null,
    depositRequiredCents: 5000,
    paymentsCents: [2000],
  }),
  {
    totalReceivedCents: 2000,
    depositPendingCents: 3000,
    remainingTotalCents: null,
    depositState: "PARTIAL",
    paymentState: "NO_PRICE",
  },
);

console.log("Money calculation checks passed");
