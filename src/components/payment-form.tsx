"use client";

import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { PaymentFormState } from "@/app/(app)/appointments/payment-actions";

type PaymentAction = (
  state: PaymentFormState,
  formData: FormData,
) => Promise<PaymentFormState>;

const initialState: PaymentFormState = { error: null, success: false };

export function PaymentForm({
  action,
  copy,
}: {
  action: PaymentAction;
  copy: Dictionary["appointments"];
}) {
  const [amount, setAmount] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);
  const submissionId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [state, formAction, pending] = useActionState(async (previousState: PaymentFormState, formData: FormData) => {
    try {
      // A retry of an unacknowledged payment must refer to the same receipt.
      submissionId.current ??= window.crypto.randomUUID();
      formData.set("submissionId", submissionId.current);
      const result = await action(previousState, formData);
      if (result.success) {
        setAmount("");
        submissionId.current = null;
      }
      return result;
    } catch (error) {
      unstable_rethrow(error);
      return { error: "save", success: false } as PaymentFormState;
    } finally {
      submitting.current = false;
    }
  }, initialState);

  useEffect(() => {
    if (state.error === "amount") amountRef.current?.focus();
  }, [state]);

  return (
    <form data-sync-protect data-sync-dirty={Boolean(amount)} data-sync-pending={pending} action={formAction} className="payment-entry-form" onReset={event => event.preventDefault()} onSubmit={event => {
      if (pending || submitting.current) event.preventDefault();
      else submitting.current = true;
    }}>
      <div className="payment-entry-heading">
        <h3>{copy.recordPayment}</h3>
        <p className="muted-copy" id="payment-entry-help">{copy.manualPaymentHelp}</p>
      </div>
      <div className="field">
        <label htmlFor="payment-amount">{copy.paymentAmount} (€)</label>
        <input
          ref={amountRef}
          id="payment-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          aria-invalid={state.error === "amount" || undefined}
          aria-describedby={state.error === "amount" ? "payment-entry-help payment-amount-error" : "payment-entry-help"}
          disabled={pending}
          required
        />
        {state.error === "amount" ? <p id="payment-amount-error" className="form-error" role="alert">{copy.paymentAmountError}</p> : null}
      </div>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? copy.recordingPayment : copy.addPayment}
      </button>
      {state.error === "save" ? <p className="form-error" role="alert">{copy.paymentSaveError}</p> : null}
      {state.success ? <p className="form-success" role="status">{copy.paymentRecorded}</p> : null}
    </form>
  );
}
