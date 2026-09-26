import { describe, expect, it } from "vitest";
import {
  calculateMoney,
  centsToDecimalString,
  parseMoneyToCents,
  validateDepositAgainstTotal,
} from "./money";

describe("money parsing", () => {
  it("parses whole and decimal amounts into integer cents", () => {
    expect(parseMoneyToCents("125")).toBe(12500);
    expect(parseMoneyToCents("125.5")).toBe(12550);
    expect(parseMoneyToCents("125,50")).toBe(12550);
    expect(centsToDecimalString(12550)).toBe("125.50");
  });

  it("rejects ambiguous or over-precise amounts", () => {
    expect(() => parseMoneyToCents("12.345")).toThrow("money_invalid");
    expect(() => parseMoneyToCents("-1")).toThrow("money_invalid");
    expect(() => parseMoneyToCents("abc")).toThrow("money_invalid");
  });
});

describe("payment states", () => {
  it("reports no deposit required", () => {
    expect(
      calculateMoney({ agreedTotalCents: 50000, depositRequiredCents: 0, receivedCents: 0 }),
    ).toEqual({
      depositRemainingCents: 0,
      finalRemainingCents: 50000,
      state: "NO_DEPOSIT_REQUIRED",
    });
  });

  it("reports a pending deposit", () => {
    expect(
      calculateMoney({ agreedTotalCents: 50000, depositRequiredCents: 10000, receivedCents: 0 }).state,
    ).toBe("DEPOSIT_PENDING");
  });

  it("reports partial payment before the deposit threshold", () => {
    const result = calculateMoney({
      agreedTotalCents: 50000,
      depositRequiredCents: 10000,
      receivedCents: 4000,
    });
    expect(result.state).toBe("PARTIALLY_PAID");
    expect(result.depositRemainingCents).toBe(6000);
    expect(result.finalRemainingCents).toBe(46000);
  });

  it("reports deposit paid once the threshold is met", () => {
    expect(
      calculateMoney({ agreedTotalCents: 50000, depositRequiredCents: 10000, receivedCents: 10000 }).state,
    ).toBe("DEPOSIT_PAID");
  });

  it("reports fully paid at or above the agreed total", () => {
    const result = calculateMoney({
      agreedTotalCents: 50000,
      depositRequiredCents: 10000,
      receivedCents: 50000,
    });
    expect(result.state).toBe("FULLY_PAID");
    expect(result.depositRemainingCents).toBe(0);
    expect(result.finalRemainingCents).toBe(0);
  });
});

describe("deposit validation", () => {
  it("rejects a required deposit above a known agreed total", () => {
    expect(() => validateDepositAgainstTotal(10000, 15000)).toThrow("deposit_exceeds_total");
  });

  it("allows a deposit when the final total is not known yet", () => {
    expect(() => validateDepositAgainstTotal(null, 15000)).not.toThrow();
  });
});
